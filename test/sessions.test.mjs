import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../dist/state.js";
import { sessionChoices, sessionList } from "../dist/sessions.js";

test("attached contexts persist across restart and reset detaches only one window while preserving model settings", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-attach-"));
  try {
    const state = new StateStore(dir); await state.load();
    await state.bindWorkspace("topic", "project", "/project");
    await state.set("topic", "existing");
    await state.setSettings("topic", { model: "original-model", effort: "high" });
    await state.attach("topic", "existing", { model: "outdated-native-model" });
    await state.attach("dm", "existing", { model: "stale-model" });
    const loaded = new StateStore(dir); await loaded.load();
    assert.equal(loaded.isLinkedThread("existing"), true);
    assert.equal(loaded.get("topic"), "existing");
    assert.equal(loaded.settings("thread:existing").model, "original-model");
    await loaded.reset("topic");
    assert.equal(loaded.get("topic"), undefined); assert.equal(loaded.get("dm"), "existing");
    assert.deepEqual(loaded.binding("topic"), { workspace: "project", cwd: "/project" });
    assert.deepEqual(loaded.settings("topic"), { model: "original-model", effort: "high" });
    const again = new StateStore(dir); await again.load(); assert.equal(again.get("dm"), "existing");
    await again.attach("topic", "existing"); assert.equal(again.get("topic"), "existing");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("failed binding persistence retains the original context and unrelated workspace metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-attach-fail-"));
  try {
    const state = new StateStore(dir); await state.load(); await state.set("dm", "old");
    state.writeSnapshot = async () => { throw Error("disk full"); };
    await assert.rejects(state.attach("dm", "new", { model: "new-model" }), /disk full/);
    assert.equal(state.get("dm"), "old"); assert.equal(state.isLinkedThread("new"), false);
    assert.equal(state.settings("thread:new"), undefined);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("session chooser labels are bounded, disambiguated and do not turn titles into mentions", () => {
  const id = "019abcde-1234-7000-8000-123456789abc";
  const page = { data: [{ id, name: "@everyone **开发计划**\n第二行", updatedAt: 1700000000 }], nextCursor: "next" };
  const choices = sessionChoices(page.data);
  assert.equal(choices[0].value, id); assert.ok(choices[0].name.length <= 100);
  assert.ok(!choices[0].name.includes("@everyone")); assert.ok(!choices[0].name.includes("\n"));
  assert.match(sessionList(page), /cursor:next/); assert.match(sessionList(page), /不会创建新会话/);
});
