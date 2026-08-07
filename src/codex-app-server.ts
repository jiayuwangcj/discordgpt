import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

type JsonObject = Record<string, unknown>;
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

export type TurnResult = {
  text: string;
  commentaryText: string;
  finalText: string;
  turnId: string;
  status: string;
};
export type TurnInput =
  | { type: "text"; text: string; text_elements: unknown[] }
  | { type: "localImage"; path: string };
export type TurnProgress =
  | { type: "delta"; delta: string; outputKind: "commentary" | "final_answer" }
  | { type: "tool_boundary" };

export class CodexAppServer extends EventEmitter {
  private proc?: ChildProcessWithoutNullStreams;
  private lines?: readline.Interface;
  private socket?: WebSocket;
  private closing = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private turns = new Map<string, {
    commentaryText: string;
    finalText: string;
    itemKinds: Map<string, "commentary" | "final_answer">;
    onProgress?: (progress: TurnProgress) => void;
    resolve: (result: TurnResult) => void;
    reject: (error: Error) => void;
  }>();
  private earlyTurnEvents = new Map<string, {
    commentaryText: string;
    finalText: string;
    itemKinds: Map<string, "commentary" | "final_answer">;
    progress: TurnProgress[];
    status?: string;
  }>();

  constructor(
    private readonly bin: string,
    private readonly cwd: string,
    private readonly defaults: { model?: string; sandbox: string; approvalPolicy: string },
    private readonly remote?: { url: string; token?: string },
  ) { super(); }

  async start(): Promise<void> {
    if (this.proc || this.socket) return;
    this.closing = false;
    if (this.remote) await this.startWebSocket();
    else this.startStdio();

    await this.request("initialize", {
      clientInfo: { name: "codex_discord_multibot", title: "Codex Discord Multibot", version: "0.1.0" },
    });
    this.notify("initialized", {});
  }

  async startThread(): Promise<string> {
    const result = await this.request("thread/start", {
      cwd: this.cwd,
      model: this.defaults.model ?? null,
      sandbox: this.defaults.sandbox,
      approvalPolicy: this.defaults.approvalPolicy,
      ephemeral: false,
    });
    return result.thread.id as string;
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.request("thread/resume", {
      threadId,
      cwd: this.cwd,
      model: this.defaults.model ?? null,
      sandbox: this.defaults.sandbox,
      approvalPolicy: this.defaults.approvalPolicy,
    });
  }

  async runTurn(
    threadId: string,
    prompt: string | TurnInput[],
    onStarted?: (turnId: string) => void,
    onProgress?: (progress: TurnProgress) => void,
  ): Promise<TurnResult> {
    const input: TurnInput[] = typeof prompt === "string"
      ? [{ type: "text", text: prompt, text_elements: [] }]
      : prompt;
    const response = await this.request("turn/start", {
      threadId,
      input,
      cwd: this.cwd,
      approvalPolicy: this.defaults.approvalPolicy,
      model: this.defaults.model ?? null,
    });
    const turnId = response.turn.id as string;
    onStarted?.(turnId);
    return new Promise<TurnResult>((resolve, reject) => {
      const early = this.earlyTurnEvents.get(turnId);
      if (early?.status) {
        this.earlyTurnEvents.delete(turnId);
        for (const progress of early.progress) onProgress?.(progress);
        resolve({
          text: early.finalText || early.commentaryText,
          commentaryText: early.commentaryText,
          finalText: early.finalText,
          turnId,
          status: early.status,
        });
      } else {
        const commentaryText = early?.commentaryText ?? "";
        this.turns.set(turnId, {
          commentaryText,
          finalText: early?.finalText ?? "",
          itemKinds: early?.itemKinds ?? new Map(),
          onProgress,
          resolve,
          reject,
        });
        for (const progress of early?.progress ?? []) onProgress?.(progress);
        this.earlyTurnEvents.delete(turnId);
      }
    });
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.socket) {
      const socket = this.socket;
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close(1000, "bridge shutdown");
      });
    } else if (this.proc) {
      const proc = this.proc;
      await new Promise<void>((resolve) => {
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
      });
    }
  }

  private startStdio(): void {
    this.proc = spawn(this.bin, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stderr.on("data", (chunk) => this.emit("log", chunk.toString().trimEnd()));
    this.proc.on("exit", (code, signal) => {
      this.proc = undefined;
      this.disconnect(new Error(`codex app-server exited (code=${code}, signal=${signal})`));
    });
    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.lines.on("line", (line) => this.onLine(line));
  }

  private async startWebSocket(): Promise<void> {
    const headers = this.remote?.token ? { Authorization: `Bearer ${this.remote.token}` } : undefined;
    const socket = new WebSocket(this.remote!.url, { headers });
    this.socket = socket;
    socket.on("message", (data) => this.onLine(data.toString()));
    socket.on("close", (code, reason) => {
      this.socket = undefined;
      this.disconnect(new Error(`app-server WebSocket closed (code=${code}, reason=${reason.toString()})`));
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.on("error", (error) => this.emit("log", `WebSocket error: ${error.message}`));
  }

  private disconnect(error: Error): void {
    this.emit("log", `${error.message}; closing=${this.closing} pending=${this.pending.size} turns=${this.turns.size}`);
    if (!this.closing) {
      for (const item of this.pending.values()) item.reject(error);
      for (const item of this.turns.values()) item.reject(error);
      this.emit("exit", error);
    }
    this.pending.clear();
    this.turns.clear();
  }

  private request(method: string, params: JsonObject): Promise<any> {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.send({ id, method, params });
    return response;
  }

  private notify(method: string, params: JsonObject): void {
    this.send({ method, params });
  }

  private send(message: JsonObject): void {
    const body = JSON.stringify(message);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(body);
    else if (this.proc) this.proc.stdin.write(`${body}\n`);
    else throw new Error("codex app-server is not connected");
  }

  private onLine(line: string): void {
    let message: any;
    try { message = JSON.parse(line); }
    catch { this.emit("log", `Invalid JSON from app-server: ${line}`); return; }

    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    // Unattended Discord sessions never grant escalation. This is defense in depth;
    // approvalPolicy=never should normally prevent these requests.
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      let result: JsonObject | undefined;
      if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
        result = { decision: "decline" };
      } else if (message.method === "applyPatchApproval" || message.method === "execCommandApproval") {
        result = { decision: { denied: { rejection: "Remote Discord sessions cannot approve escalation." } } };
      } else if (message.method === "item/permissions/requestApproval") {
        result = { permissions: {}, scope: "turn" };
      } else if (message.method === "item/tool/requestUserInput") {
        result = { answers: {} };
      } else if (message.method === "mcpServer/elicitation/request") {
        result = { action: "decline", content: null, _meta: null };
      }
      if (result) this.send({ id: message.id, result });
      else this.send({ id: message.id, error: { code: -32601, message: `Unsupported server request: ${message.method}` } });
      this.emit("log", `Declined server request: ${message.method}`);
      return;
    }

    if (message.method === "item/started") {
      const item = message.params?.item ?? {};
      const turnId = String(message.params?.turnId ?? item.turnId ?? "");
      const itemType = String(item.type ?? "");
      if (!turnId) return;
      if (isToolItemType(itemType)) {
        const progress: TurnProgress = { type: "tool_boundary" };
        const turn = this.turns.get(turnId);
        if (turn) turn.onProgress?.(progress);
        else this.getEarlyTurn(turnId).progress.push(progress);
        return;
      }
      if (itemType !== "agentMessage") return;
      const itemId = String(item.id ?? "");
      if (!itemId) return;
      const kind = classifyOutputKind(item.phase) ?? "final_answer";
      const turn = this.turns.get(turnId);
      if (turn) turn.itemKinds.set(itemId, kind);
      else this.getEarlyTurn(turnId).itemKinds.set(itemId, kind);
    } else if (message.method === "item/agentMessage/delta") {
      const turnId = String(message.params?.turnId ?? "");
      const itemId = String(message.params?.itemId ?? message.params?.item?.id ?? "");
      const delta = String(message.params?.delta ?? "");
      const turn = this.turns.get(message.params.turnId);
      if (turn) {
        const kind = classifyOutputKind(message.params?.phase) ?? turn.itemKinds.get(itemId) ?? "final_answer";
        if (kind === "commentary") turn.commentaryText += delta;
        else turn.finalText += delta;
        turn.onProgress?.({ type: "delta", delta, outputKind: kind });
      }
      else {
        const early = this.getEarlyTurn(turnId);
        const kind = classifyOutputKind(message.params?.phase) ?? early.itemKinds.get(itemId) ?? "final_answer";
        if (kind === "commentary") early.commentaryText += delta;
        else early.finalText += delta;
        early.progress.push({ type: "delta", delta, outputKind: kind });
      }
    } else if (message.method === "turn/completed") {
      const turnId = message.params.turn.id as string;
      const turn = this.turns.get(turnId);
      if (turn) {
        this.turns.delete(turnId);
        const status = String(message.params.turn.status ?? "completed");
        turn.resolve({
          text: turn.finalText || turn.commentaryText,
          commentaryText: turn.commentaryText,
          finalText: turn.finalText,
          turnId,
          status,
        });
      } else {
        const early = this.getEarlyTurn(turnId);
        early.status = String(message.params.turn.status ?? "completed");
      }
    } else if (message.method === "error") {
      this.emit("log", `Codex error: ${JSON.stringify(message.params)}`);
    }
  }

  private getEarlyTurn(turnId: string) {
    let early = this.earlyTurnEvents.get(turnId);
    if (!early) {
      early = { commentaryText: "", finalText: "", itemKinds: new Map(), progress: [] };
      this.earlyTurnEvents.set(turnId, early);
    }
    return early;
  }
}

function isToolItemType(value: string): boolean {
  return new Set([
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "webSearch",
    "imageView",
    "sleep",
    "imageGeneration",
  ]).has(value);
}

function classifyOutputKind(value: unknown): "commentary" | "final_answer" | undefined {
  const phase = String(value ?? "").trim().toLowerCase();
  if (!phase) return undefined;
  return phase === "final_answer" || phase === "final" ? "final_answer" : "commentary";
}
