import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

test("standalone bot process receives Discord DM and returns a final answer", { timeout: 20000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-runtime-"));
  const bot = { id: "100000000000000001", username: "testbot", discriminator: "0001", avatar: null, bot: true };
  const user = { id: "100000000000000002", username: "tester", discriminator: "0001", avatar: null };
  const channel = "100000000000000003";
  let received;
  const reply = new Promise((resolve) => { received = resolve; });
  const gateway = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const codex = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await Promise.all([gateway, codex].map((server) => new Promise((resolve) => server.once("listening", resolve))));
  const api = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url.includes("gateway/bot")) {
      res.end(JSON.stringify({ url: `ws://127.0.0.1:${gateway.address().port}`, shards: 1,
        session_start_limit: { total: 1000, remaining: 999, reset_after: 60000, max_concurrency: 1 } }));
    } else if (req.url.includes("users/@me")) res.end(JSON.stringify(bot));
    else if (req.method === "POST" && req.url.includes("/messages")) {
      const payload = JSON.parse(body);
      received(payload);
      res.end(JSON.stringify({ id: "100000000000000005", channel_id: channel, author: bot,
        content: payload.content, timestamp: new Date().toISOString(), type: 0, attachments: [], embeds: [] }));
    } else if (req.url.includes(`/channels/${channel}`)) {
      res.end(JSON.stringify({ id: channel, type: 1, recipients: [user] }));
    } else { res.statusCode = 204; res.end(); }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  gateway.on("connection", (socket) => {
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.op === 1) socket.send(JSON.stringify({ op: 11 }));
      if (event.op !== 2) return;
      socket.send(JSON.stringify({ op: 0, t: "READY", s: 1, d: {
        v: 10, user: bot, guilds: [], session_id: "test-session", shard: [0, 1],
        resume_gateway_url: `ws://127.0.0.1:${gateway.address().port}`, application: { id: bot.id, flags: 0 },
      } }));
      setTimeout(() => socket.send(JSON.stringify({ op: 0, t: "MESSAGE_CREATE", s: 2, d: {
        id: "100000000000000004", channel_id: channel, channel_type: 1, author: user, content: "hello",
        timestamp: new Date().toISOString(), type: 0, mentions: [], mention_roles: [],
        attachments: [], embeds: [], components: [], flags: 0, pinned: false, tts: false,
      } })), 100);
    });
  });
  let prompt;
  codex.on("connection", (socket) => socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    if (event.method === "initialize") socket.send(JSON.stringify({ id: event.id, result: {} }));
    if (event.method === "thread/start") socket.send(JSON.stringify({ id: event.id, result: { thread: { id: "thread-test" } } }));
    if (event.method === "turn/start") {
      prompt = event.params.input[0].text;
      socket.send(JSON.stringify({ id: event.id, result: { turn: { id: "turn-test" } } }));
      socket.send(JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-test", delta: "Standalone reply" } }));
      socket.send(JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn-test", status: "completed" } } }));
    }
  }));
  const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
    env: { PATH: process.env.PATH, HOME: dir, DISCORD_BOT_TOKEN: "test-only-token",
      DISCORD_ALLOWED_USER_IDS: user.id, CODEX_PROJECT_DIR: dir,
      CODEX_DISCORD_STATE_DIR: path.join(dir, "state"),
      CODEX_DISCORD_ENV_FILE: path.join(dir, "missing.env"),
      CODEX_APP_SERVER_URL: `ws://127.0.0.1:${codex.address().port}`,
      DISCORD_API_BASE_URL: `http://127.0.0.1:${api.address().port}/api` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  let timer;
  try {
    const payload = await Promise.race([reply, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Bot did not reply: ${logs}`)), 12000);
    })]);
    assert.equal(payload.content, "Standalone reply");
    assert.equal(prompt, "hello");
    assert.deepEqual(payload.allowed_mentions.parse, []);
    const state = JSON.parse(await fs.readFile(path.join(dir, "state/state.json"), "utf8"));
    assert.equal(state.threads[channel], "thread-test");
  } finally {
    clearTimeout(timer);
    const exit = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exit;
    for (const server of [gateway, codex]) {
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    }
    await new Promise((resolve) => api.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
