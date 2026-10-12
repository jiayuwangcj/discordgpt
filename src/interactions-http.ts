import { createPublicKey, verify } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { applicationCommands } from "./commands.js";

const commandNames = new Set(applicationCommands().map((c) => c.name));
export function ownsInteraction(payload: any): boolean {
  return (payload.type === 2 || payload.type === 4) && commandNames.has(payload.data?.name)
    || payload.type === 3 && typeof payload.data?.custom_id === "string" && payload.data.custom_id.startsWith("task:");
}
export type InteractionDispatcher = (payload: any, respond: (response: any) => void) => Promise<void>;

/** Signed HTTP ingress; forward non-chat actions unchanged to the prior endpoint. */
export function interactionHandler(publicKeyHex: string, dispatch: InteractionDispatcher, fallbackUrl?: string,
  forward: typeof fetch = fetch) {
  if (!/^[a-f0-9]{64}$/i.test(publicKeyHex)) throw new Error("Invalid Discord public key");
  if (fallbackUrl && new URL(fallbackUrl).protocol !== "https:") throw new Error("Interaction fallback requires HTTPS");
  const responses = new Map<string, { at: number; response: any }>();
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
  return async (req: IncomingMessage, res: ServerResponse) => {
    const respond = (status: number, payload: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload));
    };
    if (req.method !== "POST") { respond(405, { error: "POST required" }); return; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 256 * 1024) { respond(413, { error: "Request too large" }); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const signature = req.headers["x-signature-ed25519"];
      const timestamp = req.headers["x-signature-timestamp"];
      if (typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature) || typeof timestamp !== "string"
        || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
        || !verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, "hex"))) {
        respond(401, { error: "Invalid signature" }); return;
      }
      const payload = JSON.parse(body.toString());
      if (payload.type === 1) { respond(200, { type: 1 }); return; }
      if (ownsInteraction(payload)) {
        for (const [id, cached] of responses) if (Date.now() - cached.at > 60 * 60_000) responses.delete(id);
        const cached = typeof payload.id === "string" ? responses.get(payload.id) : undefined;
        if (cached) { respond(200, cached.response); return; }
        await dispatch(payload, (response) => {
          if (typeof payload.id === "string") {
            if (responses.size >= 2048) responses.delete(responses.keys().next().value!);
            responses.set(payload.id, { at: Date.now(), response });
          }
          respond(200, response);
        });
        return;
      }
      if (!fallbackUrl) { respond(200, { type: 4, data: { content: "该交互不由 discordgpt 处理。", flags: 64 } }); return; }
      const forwarded = await forward(fallbackUrl, { method: "POST", signal: AbortSignal.timeout(2500),
        headers: { "Content-Type": "application/json", "x-signature-ed25519": signature, "x-signature-timestamp": timestamp,
          "User-Agent": req.headers["user-agent"] || "DiscordBot (https://discord.com, v1.0)" }, body });
      if (!forwarded.ok) { respond(502, { error: "Existing interaction handler unavailable" }); return; }
      respond(forwarded.status, await forwarded.json());
    } catch { respond(500, { error: "Interaction handling failed" }); }
  };
}

export async function startInteractionServer(port: number, publicKey: string, dispatch: InteractionDispatcher, fallbackUrl?: string) {
  const server = createServer(interactionHandler(publicKey, dispatch, fallbackUrl));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  server.on("error", () => console.error("Interaction HTTP listener error"));
  return server;
}
