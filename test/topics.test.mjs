import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { StateStore } from "../dist/state.js";
import { loadWorkspaces } from "../dist/workspaces.js";
import { resolveWorkspace, topicRequest } from "../dist/topic-routing.js";
import { CodexAppServer } from "../dist/codex-app-server.js";

test("Discord topics retain separate workspaces and contexts across restart, including legacy DM", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-topics-"));
  try {
    const state = new StateStore(dir);
    await state.load();
    await state.set("dm", "legacy-dm");
    await Promise.all([
      state.bindWorkspace("topic-a", "a", "/work/a"),
      state.bindWorkspace("topic-b", "b", "/work/b"),
      state.bindWorkspace("topic-c", "a", "/work/a"),
    ]);
    await state.set("topic-a", "thread-a");
    await state.set("topic-b", "thread-b");
    await state.set("topic-c", "thread-c");
    await state.recordTopic({ id: "topic-a", parentId: "main", guildId: "guild", ownerId: "owner", name: "开发", workspace: "a" });
    const restored = new StateStore(dir);
    await restored.load();
    const workspaces = { default: dir, a: "/work/a", b: "/work/b" };
    assert.equal(resolveWorkspace(restored, "topic-a", true, workspaces).cwd, "/work/a");
    assert.equal(resolveWorkspace(restored, "topic-b", true, workspaces).cwd, "/work/b");
    assert.equal(resolveWorkspace(restored, "dm", false, workspaces).cwd, dir);
    assert.equal(restored.get("dm"), "legacy-dm");
    assert.equal(restored.get("topic-c"), "thread-c");
    assert.equal(restored.topics("main", "owner")[0].id, "topic-a");
    assert.deepEqual(restored.topics("other-main", "owner"), []);
    assert.deepEqual(restored.topics("main", "other-owner"), []);
    await restored.reset("topic-a");
    assert.equal(restored.get("topic-a"), undefined);
    assert.equal(restored.get("topic-c"), "thread-c");
    assert.equal(restored.binding("topic-a").workspace, "a");
    assert.throws(() => resolveWorkspace(restored, "unbound", true, workspaces), /no workspace/);
    assert.throws(() => resolveWorkspace(restored, "topic-b", true, { ...workspaces, b: "/moved" }), /changed/);
    await assert.rejects(restored.bindWorkspace("topic-a", "b", "/work/b"), /immutable/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("workspace host configuration validates aliases, absolute existing directories and default", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-workspaces-"));
  const file = path.join(dir, "workspaces.json");
  try {
    await fs.writeFile(file, JSON.stringify({ demo: dir }));
    assert.equal((await loadWorkspaces(dir, file)).demo, dir);
    for (const value of [{ demo: "relative" }, { "../bad": dir }, [], { default: "/changed" }]) {
      await fs.writeFile(file, JSON.stringify(value));
      await assert.rejects(loadWorkspaces(dir, file));
    }
    assert.deepEqual(topicRequest("!codex topic demo 修复报告"), { workspace: "demo", name: "修复报告" });
    assert.deepEqual(topicRequest("!codex topic demo"), { workspace: "demo", name: "demo" });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("start/resume/turn RPC always receives the selected topic cwd", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => wss.once("listening", resolve));
  const calls = [];
  wss.on("connection", (socket) => socket.on("message", (raw) => {
    const event = JSON.parse(raw.toString());
    calls.push(event);
    if (event.method === "initialize" || event.method === "thread/resume") socket.send(JSON.stringify({ id: event.id, result: {} }));
    if (event.method === "thread/start") socket.send(JSON.stringify({ id: event.id, result: { thread: { id: "topic-thread" } } }));
    if (event.method === "turn/start") {
      socket.send(JSON.stringify({ id: event.id, result: { turn: { id: "topic-turn" } } }));
      socket.send(JSON.stringify({ method: "turn/completed", params: { turn: { id: "topic-turn", status: "completed" } } }));
    }
  }));
  const server = new CodexAppServer("unused", "/default", { sandbox: "workspace-write", approvalPolicy: "never" },
    { url: `ws://127.0.0.1:${wss.address().port}` });
  try {
    await server.start();
    await server.startThread("/selected");
    await server.resumeThread("topic-thread", "/selected");
    await server.runTurn("topic-thread", "hello", undefined, undefined, "/selected");
    for (const call of calls.filter((item) => ["thread/start", "thread/resume", "turn/start"].includes(item.method))) {
      assert.equal(call.params.cwd, "/selected");
    }
  } finally {
    await server.close();
    await new Promise((resolve) => wss.close(resolve));
  }
});
