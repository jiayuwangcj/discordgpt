import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

for (const scenario of ["dm", "topics", "natural"]) test(`standalone bot process: ${scenario}`, { timeout: 20000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-runtime-"));
  const bot = { id: "100000000000000001", username: "testbot", discriminator: "0001", avatar: null, bot: true };
  const user = { id: "100000000000000002", username: "tester", discriminator: "0001", avatar: null };
  const channel = "100000000000000003";
  const guild = "100000000000000010";
  const parent = "100000000000000011";
  const workspaceA = path.join(dir, "project-a");
  const workspaceB = path.join(dir, "project-b");
  await fs.mkdir(workspaceA);
  await fs.mkdir(workspaceB);
  const workspaceFile = path.join(dir, "workspaces.json");
  await fs.writeFile(workspaceFile, JSON.stringify({ alpha: workspaceA, beta: workspaceB }));
  const topics = [];
  const replies = [];
  const httpCalls = [];
  let gatewaySocket;
  let sequence = 2;
  const sendMessage = (channelId, content, type = 1) => gatewaySocket.send(JSON.stringify({
    op: 0, t: "MESSAGE_CREATE", s: sequence++, d: {
      id: String(BigInt("100000000000000100") + BigInt(sequence)), channel_id: channelId,
      channel_type: type, ...(type !== 1 ? { guild_id: guild, member: { roles: [], joined_at: new Date().toISOString() } } : {}),
      author: user, content: type === 0 ? `<@${bot.id}> ${content}` : content,
      timestamp: new Date().toISOString(), type: 0, mentions: type === 0 ? [bot] : [], mention_roles: [],
      attachments: [], embeds: [], components: [], flags: 0, pinned: false, tts: false,
    },
  }));
  let received;
  const reply = new Promise((resolve) => { received = resolve; });
  const gateway = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  const codex = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await Promise.all([gateway, codex].map((server) => new Promise((resolve) => server.once("listening", resolve))));
  const api = http.createServer(async (req, res) => {
    httpCalls.push(`${req.method} ${req.url}`);
    res.setHeader("Content-Type", "application/json");
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url.includes("gateway/bot")) {
      res.end(JSON.stringify({ url: `ws://127.0.0.1:${gateway.address().port}`, shards: 1,
        session_start_limit: { total: 1000, remaining: 999, reset_after: 60000, max_concurrency: 1 } }));
    } else if (req.url.includes("users/@me")) res.end(JSON.stringify(bot));
    else if (req.method === "POST" && req.url.endsWith("/threads")) {
      const payload = JSON.parse(body);
      assert.equal(payload.type, 12);
      assert.equal(payload.invitable, false);
      const topic = { id: String(BigInt("100000000000000020") + BigInt(topics.length)), type: 12,
        guild_id: guild, parent_id: parent, name: payload.name, owner_id: bot.id,
        thread_metadata: { archived: false, auto_archive_duration: 1440, archive_timestamp: new Date().toISOString(), locked: false, invitable: false } };
      topics.push(topic);
      res.end(JSON.stringify(topic));
    }
    else if (req.method === "POST" && req.url.includes("/messages")) {
      const payload = JSON.parse(body);
      const replyChannel = req.url.match(/channels\/(\d+)/)[1];
      if (scenario === "dm") received(payload);
      else if (payload.content.startsWith("Created topic") || payload.content.startsWith("已创建话题")) {
        setTimeout(() => {
          if (scenario === "natural") {
            sendMessage(parent, topics.length === 1 ? "打开 alpha" : "列出我的工作区和话题", 0);
          } else if (topics.length === 1) sendMessage(parent, "!codex topic beta Backend", 0);
          else {
            sendMessage(topics[0].id, "alpha-task", 12);
            sendMessage(topics[1].id, "beta-task", 12);
            sendMessage(channel, "dm-task");
          }
        }, 10);
      } else if (scenario === "natural" && payload.content.startsWith("打开话题")) {
        assert.equal(topics.length, 1);
        setTimeout(() => sendMessage(parent, "给 beta 开一个话题，叫 Backend", 0), 10);
      } else if (scenario === "natural" && payload.content.startsWith("工作区：")) {
        assert.ok(payload.content.includes(topics[0].id) && payload.content.includes(topics[1].id));
        setTimeout(() => sendMessage(parent, "修改工程代码", 0), 10);
      } else if (scenario === "natural" && payload.content.startsWith("这里是工作区管理入口")) {
        setTimeout(() => {
          sendMessage(topics[0].id, "alpha-task", 12);
          sendMessage(topics[1].id, "beta-task", 12);
          sendMessage(channel, "dm-task");
        }, 10);
      } else if (payload.content === "Standalone reply") {
        replies.push({ ...payload, channel: replyChannel });
        if (replies.length === 3) received(replies);
      }
      res.end(JSON.stringify({ id: "100000000000000005", channel_id: channel, author: bot,
        content: payload.content, timestamp: new Date().toISOString(), type: 0, attachments: [], embeds: [] }));
    } else if (req.method === "GET" && topics.some((topic) => req.url.endsWith(`/channels/${topic.id}`))) {
      res.end(JSON.stringify(topics.find((topic) => req.url.endsWith(`/channels/${topic.id}`))));
    } else if (req.url.includes(`/channels/${channel}`)) {
      res.end(JSON.stringify({ id: channel, type: 1, recipients: [user] }));
    } else { res.removeHeader("Content-Type"); res.statusCode = 204; res.end(); }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  gateway.on("connection", (socket) => {
    gatewaySocket = socket;
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.op === 1) socket.send(JSON.stringify({ op: 11 }));
      if (event.op !== 2) return;
      socket.send(JSON.stringify({ op: 0, t: "READY", s: 1, d: {
        v: 10, user: bot, guilds: [], session_id: "test-session", shard: [0, 1],
        resume_gateway_url: `ws://127.0.0.1:${gateway.address().port}`, application: { id: bot.id, flags: 0 },
      } }));
      if (scenario !== "dm") socket.send(JSON.stringify({ op: 0, t: "GUILD_CREATE", s: sequence++, d: {
        id: guild, name: "Test server", unavailable: false, owner_id: user.id, member_count: 2,
        roles: [{ id: guild, name: "@everyone", permissions: "8", position: 0, color: 0, hoist: false, managed: false, mentionable: false }],
        members: [bot, user].map((account) => ({ user: account, roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false })),
        channels: [{ id: parent, guild_id: guild, type: 0, name: "codex", permission_overwrites: [] }],
        threads: [], emojis: [], stickers: [], presences: [], voice_states: [], features: [],
      } }));
      setTimeout(() => scenario === "dm" ? sendMessage(channel, "hello") : sendMessage(parent,
        scenario === "natural" ? "给 alpha 开一个话题，叫 Frontend" : "!codex topic alpha Frontend", 0), 100);
    });
  });
  let prompt;
  const calls = [];
  let threadCount = 0;
  let turnCount = 0;
  codex.on("connection", (socket) => socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    calls.push(event);
    if (event.method === "initialize") socket.send(JSON.stringify({ id: event.id, result: {} }));
    if (event.method === "thread/resume") socket.send(JSON.stringify({ id: event.id, result: {} }));
    if (event.method === "thread/start") socket.send(JSON.stringify({ id: event.id, result: { thread: { id: scenario === "dm" ? "thread-test" : `thread-${++threadCount}` } } }));
    if (event.method === "turn/start") {
      prompt = event.params.input[0].text;
      const turnId = `turn-${++turnCount}`;
      socket.send(JSON.stringify({ id: event.id, result: { turn: { id: turnId } } }));
      socket.send(JSON.stringify({ method: "item/agentMessage/delta", params: { turnId, delta: "Standalone reply" } }));
      socket.send(JSON.stringify({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } }));
    }
  }));
  const child = spawn(process.execPath, [path.resolve("dist/index.js")], {
    env: { PATH: process.env.PATH, HOME: dir, DISCORD_BOT_TOKEN: "test-only-token",
      DISCORD_ALLOWED_USER_IDS: user.id, CODEX_PROJECT_DIR: dir,
      CODEX_DISCORD_STATE_DIR: path.join(dir, "state"),
      CODEX_WORKSPACES_FILE: workspaceFile,
      DISCORD_REQUIRE_MENTION: "true",
      ...(scenario !== "dm" ? { DISCORD_ALLOWED_CHANNEL_IDS: `${parent},${channel}`, CODEX_SHARED_THREAD_ID: "shared-dm" } : {}),
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
      timer = setTimeout(() => reject(new Error(`Bot did not reply: ${logs}\nHTTP: ${httpCalls.join("\n")}`)), 12000);
    })]);
    const state = JSON.parse(await fs.readFile(path.join(dir, "state/state.json"), "utf8"));
    if (scenario === "dm") {
      assert.equal(payload.content, "Standalone reply");
      assert.equal(prompt, "hello");
      assert.deepEqual(payload.allowed_mentions.parse, []);
      assert.equal(state.threads[channel], "thread-test");
    } else {
      assert.equal(topics.length, 2);
      assert.equal(state.workspaces[topics[0].id].cwd, workspaceA);
      assert.equal(state.workspaces[topics[1].id].cwd, workspaceB);
      const turns = calls.filter((event) => event.method === "turn/start");
      assert.equal(turns.length, 3);
      assert.equal(new Set(turns.map((event) => event.params.threadId)).size, 3);
      assert.equal(turns.find((event) => event.params.input[0].text === "dm-task").params.threadId, "shared-dm");
      for (const [task, cwd] of [["alpha-task", workspaceA], ["beta-task", workspaceB], ["dm-task", dir]]) {
        assert.equal(turns.find((event) => event.params.input[0].text === task).params.cwd, cwd);
      }
      assert.deepEqual(new Set(payload.map((reply) => reply.channel)), new Set([channel, ...topics.map((topic) => topic.id)]));
    }
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
