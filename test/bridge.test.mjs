import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { CodexAppServer } from "../dist/codex-app-server.js";
import { StateStore } from "../dist/state.js";
import { parseHistoryRequest } from "../dist/history.js";
import { ProgressRelay } from "../dist/progress-relay.js";
import { prepareTurnInput } from "../dist/attachments.js";

test("history requests are explicit and bounded", () => {
  assert.equal(parseHistoryRequest("please read history"), undefined);
  assert.deepEqual(parseHistoryRequest("!codex history 30 summarize decisions"), {
    limit: 30,
    task: "summarize decisions",
  });
  assert.equal(parseHistoryRequest("!codex history 999").limit, 100);
  assert.equal(parseHistoryRequest("!codex history 0").limit, 1);
});

test("shared WebSocket transport initializes and streams a turn", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  assert.equal(typeof address, "object");
  wss.on("connection", (socket) => socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
    else if (message.method === "thread/start") {
      socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "thread-ws" } } }));
    } else if (message.method === "turn/start") {
      socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "turn-ws" } } }));
      socket.send(JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-ws", delta: "shared " } }));
      socket.send(JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-ws", delta: "status" } }));
      socket.send(JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn-ws", status: "completed" } } }));
    }
  }));

  const server = new CodexAppServer("unused", process.cwd(), {
    sandbox: "workspace-write",
    approvalPolicy: "never",
  }, { url: `ws://127.0.0.1:${address.port}` });
  await server.start();
  const threadId = await server.startThread();
  const result = await server.runTurn(threadId, "test");
  assert.equal(threadId, "thread-ws");
  assert.equal(result.text, "shared status");
  await server.close();
  await new Promise((resolve) => wss.close(resolve));
});

test("commentary progress is emitted before the final answer", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  wss.on("connection", (socket) => socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
    else if (message.method === "turn/start") {
      socket.send(JSON.stringify({ id: message.id, result: { turn: { id: "turn-progress" } } }));
      socket.send(JSON.stringify({ method: "item/started", params: { turnId: "turn-progress", item: { id: "comment-1", type: "agentMessage", phase: "commentary" } } }));
      socket.send(JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-progress", itemId: "comment-1", delta: "先检查。" } }));
      socket.send(JSON.stringify({ method: "item/started", params: { turnId: "turn-progress", item: { id: "tool-1", type: "commandExecution" } } }));
      socket.send(JSON.stringify({ method: "item/started", params: { turnId: "turn-progress", item: { id: "final-1", type: "agentMessage", phase: "final_answer" } } }));
      socket.send(JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-progress", itemId: "final-1", delta: "完成" } }));
      socket.send(JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn-progress", status: "completed" } } }));
    }
  }));
  const server = new CodexAppServer("unused", process.cwd(), {
    sandbox: "workspace-write", approvalPolicy: "never",
  }, { url: `ws://127.0.0.1:${address.port}` });
  await server.start();
  const progress = [];
  const result = await server.runTurn("thread-1", "test", undefined, (update) => progress.push(update));
  assert.deepEqual(progress, [
    { type: "delta", delta: "先检查。", outputKind: "commentary" },
    { type: "tool_boundary" },
    { type: "delta", delta: "完成", outputKind: "final_answer" },
  ]);
  assert.equal(result.text, "完成");
  assert.equal(result.commentaryText, "先检查。");
  assert.equal(result.finalText, "完成");
  await server.close();
  await new Promise((resolve) => wss.close(resolve));
});

test("progress relay flushes commentary only at a tool boundary", async () => {
  const sent = [];
  const relay = new ProgressRelay(async (text) => { sent.push(text); });
  relay.push("先检查。", "commentary");
  relay.push("最终答案", "final_answer");
  assert.deepEqual(sent, []);
  await relay.flushBeforeTool();
  relay.push("工具结束后继续说明。", "commentary");
  await relay.finish();
  assert.deepEqual(sent, ["⏳ 先检查。"]);
  assert.equal(relay.hasSent, true);
});

test("progress relay never flushes pure text because of time, length, or punctuation", async () => {
  const sent = [];
  const relay = new ProgressRelay(async (text) => { sent.push(text); });
  relay.push("开源仓库将包含：\n", "commentary");
  relay.push("- Discord adapter；\n", "commentary");
  relay.push("- Weixin integration；\n", "commentary");
  relay.push(`- 两套 skills。${"x".repeat(2000)}`, "commentary");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(sent, []);
  await relay.finish();
  assert.deepEqual(sent, []);
});

test("Discord images become localImage turn inputs and are cleaned up", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-discord-images-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
  try {
    const prepared = await prepareTurnInput("inspect", [{
      name: "screen.png",
      url: "https://cdn.discordapp.com/attachments/a/b/screen.png",
      contentType: "image/png",
      size: 4,
    }], dir, "message-1");
    assert.equal(prepared.input[0].type, "text");
    assert.equal(prepared.input[1].type, "localImage");
    await fs.access(prepared.input[1].path);
    await prepared.cleanup();
    await assert.rejects(fs.access(prepared.input[1].path));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("state mappings survive reload and reset", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-discord-test-"));
  const first = new StateStore(dir);
  await first.load();
  await first.set("channel-a", "thread-a");
  const second = new StateStore(dir);
  await second.load();
  assert.equal(second.get("channel-a"), "thread-a");
  await second.reset("channel-a");
  assert.equal(second.get("channel-a"), undefined);
});
