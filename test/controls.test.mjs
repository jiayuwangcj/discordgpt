import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelCatalog } from "../dist/models.js";
import { UsageMonitor, quotaError, remaining } from "../dist/usage.js";
import { TaskScheduler, QuotaPause } from "../dist/task-scheduler.js";
import { LifecycleNotifier, startHeartbeat } from "../dist/notifications.js";
import { StateStore } from "../dist/state.js";
import { AuditLog } from "../dist/audit.js";
import { applicationCommands } from "../dist/commands.js";

const models = [
  { id: "astra", model: "gpt-6-astra", isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "ultra" }], defaultReasoningEffort: "high" },
  { id: "luna", model: "gpt-6-luna", supportedReasoningEfforts: [{ reasoningEffort: "medium" }], defaultReasoningEffort: "medium" },
  { id: "fast", model: "no-reasoning", supportedReasoningEfforts: [], defaultReasoningEffort: "none" },
];
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("model selection uses a live catalog, prevents incompatible effort and ambiguous aliases", async () => {
  const catalog = new ModelCatalog(async () => models);
  assert.throws(() => catalog.select("astra"), /暂不可用/);
  await catalog.refresh();
  assert.deepEqual(catalog.select("astra", "ultra"), { model: "gpt-6-astra", effort: "ultra" });
  assert.deepEqual(catalog.select("luna", undefined, { model: "gpt-6-astra", effort: "ultra" }), { model: "gpt-6-luna", effort: "medium" });
  assert.deepEqual(catalog.select("fast"), { model: "no-reasoning" });
  assert.throws(() => catalog.select("luna", "ultra"), /原设置保留/);
  assert.throws(() => catalog.select("unknown"), /未知模型/);
  catalog.models.push({ ...models[1], id: "other-luna", model: "gpt-5.6-luna" });
  catalog.models[1] = { ...catalog.models[1], id: "gpt-6-luna" };
  assert.throws(() => catalog.select("luna"), /简称不唯一/);
});

test("failed model refresh retains last catalog but disables changes", async () => {
  let fail = false;
  const catalog = new ModelCatalog(async () => { if (fail) throw Error("offline"); return models; });
  await catalog.refresh(); fail = true;
  await assert.rejects(catalog.refresh());
  assert.match(catalog.describe(), /上次读取/);
  assert.throws(() => catalog.select("astra"), /原设置保留/);
});

test("session settings survive reset and restart and remain isolated", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-settings-"));
  try {
    const store = new StateStore(dir); await store.load();
    await store.set("a", "thread-a");
    await store.setSettings("a", { model: "gpt-6-astra", effort: "ultra" });
    await store.setSettings("b", { model: "gpt-6-luna", effort: "medium" });
    await store.reset("a");
    const loaded = new StateStore(dir); await loaded.load();
    assert.equal(loaded.get("a"), undefined);
    assert.equal(loaded.settings("a").effort, "ultra");
    assert.equal(loaded.settings("b").model, "gpt-6-luna");
    assert.equal((await fs.stat(path.join(dir, "state.json"))).mode & 0o777, 0o600);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("usage projects every bucket, reset time and stale snapshots without leaking account secrets", async () => {
  let fail = false;
  const usage = new UsageMonitor(async () => {
    if (fail) throw Error("offline");
    return { ordinaryUsageAllowed: true, rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 21, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 8, windowDurationMins: 10080 } },
      other: { primary: { usedPercent: 75, windowDurationMins: 60 } },
    } };
  }, async () => ({ account: { type: "chatgpt", planType: "pro", email: "private@example.com", token: "secret" } }));
  await usage.refresh();
  assert.match(usage.summary(), /5h-79% w-92%/);
  assert.match(usage.summary(), /other: 1h-25%/);
  assert.match(usage.summary(), /2027/);
  assert.doesNotMatch(usage.summary(), /private|secret/);
  assert.equal(usage.canResume(), true);
  fail = true; await assert.rejects(usage.refresh());
  assert.equal(usage.canResume(), false);
  assert.match(usage.summary(), /上次读取/);
  assert.equal(remaining({ usedPercent: 150 }), 0);
  assert.equal(remaining({ usedPercent: -5 }), 100);
  assert.equal(remaining({ usedPercent: NaN }), undefined);
});

test("quota recovery requires fresh backend permission, not percentages or guessed resets", async () => {
  const usage = new UsageMonitor(async () => ({ rateLimits: { primary: { usedPercent: 0, resetsAt: 1 } } }), async () => ({}));
  await usage.refresh(); assert.equal(usage.canResume(), false);
  assert.equal(quotaError({ message: "You've hit your usage limit" }), true);
  assert.equal(quotaError(Error("HTTP 429")), true);
  assert.equal(quotaError(Error("ordinary timeout")), false);
});

test("task controls cancel only their owner's queued request and preserve FIFO across quota recovery", async () => {
  const scheduler = new TaskScheduler();
  const events = [];
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const info = (id, key = "a") => ({ id, key, channelId: key, userId: "owner" });
  const first = scheduler.enqueue(info("1"), async () => { events.push("1"); await hold; });
  const second = scheduler.enqueue(info("2"), async () => assert.fail("Cancelled request executed"));
  const third = scheduler.enqueue(info("3"), async (retry) => { events.push(retry ? "3-resume" : "3"); if (!retry) throw new QuotaPause(); });
  const fourth = scheduler.enqueue(info("4"), async () => events.push("4"));
  assert.equal(scheduler.cancel("2", "a", "intruder"), false);
  assert.equal(scheduler.cancel("2", "wrong-channel", "owner"), false);
  assert.equal(scheduler.cancel("2", "a", "owner"), true);
  await scheduler.enqueue(info("other", "b"), async () => events.push("b"));
  release(); await first; await second; await tick();
  assert.equal(scheduler.list("a")[0].phase, "paused");
  scheduler.resumePaused("b"); await tick(); assert.equal(scheduler.list("a")[0].phase, "paused");
  scheduler.resumePaused("a"); await Promise.all([third, fourth]);
  assert.deepEqual(events, ["1", "b", "3", "3-resume", "4"]);
});

test("cancelled quota pauses release later tasks; drain refuses new admission", async () => {
  const scheduler = new TaskScheduler(2);
  const a = { id: "a", key: "key", channelId: "channel", userId: "owner" };
  const first = scheduler.enqueue(a, async () => { throw new QuotaPause(); });
  await tick();
  let ran = false;
  const second = scheduler.enqueue({ ...a, id: "b" }, async () => { ran = true; });
  assert.equal(scheduler.cancel("a", "channel", "owner"), true);
  await Promise.all([first, second]); assert.equal(ran, true);
  scheduler.draining = true;
  await assert.rejects(scheduler.enqueue(a, async () => {}), /重启/);
});

test("admission can be aborted before a native turn exists", async () => {
  const scheduler = new TaskScheduler();
  const running = scheduler.enqueue({ id: "a", key: "k", channelId: "c", userId: "u" }, async (_, signal) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    signal.throwIfAborted();
  });
  const failure = assert.rejects(running, { name: "AbortError" });
  await tick(); assert.equal(scheduler.abortAdmission("a", "c", "u"), true); await failure;
  assert.equal(scheduler.size("k"), 0);
});

test("lifecycle sends authorized DMs, isolates send failures and never repeats ready on reconnect", async () => {
  const sent = [];
  const notifier = new LifecycleNotifier(new Set(["u", "offline"]), async (id, text) => {
    if (id === "offline") throw Error("offline"); sent.push({ id, text });
  }, () => {});
  await notifier.notify("正在启动"); await notifier.ready(); await notifier.ready();
  assert.equal(sent.length, 2);
  assert.ok(sent.every((item) => item.id === "u" && item.text.startsWith("【系统消息】")));
});

test("long-task heartbeat stops after completion and short tasks remain silent", async () => {
  const sent = [];
  const stop = startHeartbeat(async (text) => sent.push(text), 10);
  await new Promise((resolve) => setTimeout(resolve, 25)); stop(); const before = sent.length;
  assert.ok(before >= 1);
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(sent.length, before);
  const stopShort = startHeartbeat(async () => assert.fail("short task heartbeat"), 20); stopShort();
});

test("audit journal serializes writes, redacts payload fields and rotates with private permissions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-audit-"));
  try {
    const audit = new AuditLog(dir, 220);
    await Promise.all(Array.from({ length: 8 }, (_, i) => audit.append("task", { messageId: String(i), prompt: "SECRET", token: "TOKEN" })));
    const text = await fs.readFile(path.join(dir, "audit.jsonl"), "utf8");
    const previous = await fs.readFile(path.join(dir, "audit.jsonl.1"), "utf8");
    assert.doesNotMatch(text + previous, /SECRET|TOKEN/);
    for (const line of (text + previous).trim().split("\n")) assert.equal(JSON.parse(line).event, "task");
    assert.equal((await fs.stat(path.join(dir, "audit.jsonl"))).mode & 0o777, 0o600);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("all legacy slash controls remain available alongside multi-window commands", () => {
  const commands = applicationCommands();
  const names = commands.map((c) => c.name);
  for (const name of ["model", "status", "ps", "stop", "compact", "side", "usage", "models", "cancel", "steer", "resume", "topic", "workspaces", "reset"]) assert.ok(names.includes(name));
  assert.ok(commands.find((c) => c.name === "model").options.every((o) => o.autocomplete));
});

test("resume/cancel during a delayed pause notice cannot strand the remaining FIFO", async () => {
  for (const action of ["resume", "cancel"]) {
    const scheduler = new TaskScheduler();
    let releaseNotice;
    const notice = new Promise((resolve) => { releaseNotice = resolve; });
    const first = scheduler.enqueue({ id: "a", key: "k", channelId: "c", userId: "u" }, async (retry) => {
      if (!retry) throw new QuotaPause();
    }, async (phase) => { if (phase === "paused") await notice; });
    await tick();
    let completed = false;
    const second = scheduler.enqueue({ id: "b", key: "k", channelId: "c", userId: "u" }, async () => { completed = true; });
    if (action === "resume") scheduler.resumePaused("k");
    else assert.equal(scheduler.cancel("a", "c", "u"), true);
    releaseNotice(); await Promise.all([first, second]); assert.equal(completed, true);
  }
});
