import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../dist/state.js";
import { WorkspaceReloader } from "../dist/workspace-reload.js";

test("workspace reload adds topics without replacing live threads, settings or shared contexts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-reload-"));
  try {
    const state = new StateStore(dir); await state.load();
    const workspacesFile = path.join(dir, "workspaces.json");
    const topicFile = path.join(dir, "topic-bindings.json");
    await fs.writeFile(workspacesFile, JSON.stringify({ wrt: dir }));
    const topic = { id: "123", parentId: "2", guildId: "3", ownerId: "1", name: "wrt", workspace: "wrt" };
    await fs.writeFile(topicFile, JSON.stringify([topic]));
    const events = [];
    const reload = new WorkspaceReloader({ projectDir: dir, workspacesFile, stateDir: dir,
      allowedUsers: new Set(["1"]), allowedChannels: new Set(["2"]) }, state, (...event) => events.push(event));
    await Promise.all([reload.refresh(), reload.refresh(), state.attach("busy", "shared", { model: "running-model" }), state.set("other", "other-thread")]);
    assert.equal(reload.status.error, undefined);
    assert.equal(state.binding("123").cwd, dir);
    assert.equal(state.topics("2", "1")[0].id, "123");
    const restored = new StateStore(dir); await restored.load();
    assert.equal(restored.get("busy"), "shared");
    assert.equal(restored.isLinkedThread("shared"), true);
    assert.equal(restored.settings("thread:shared").model, "running-model");
    assert.equal(restored.get("other"), "other-thread");
    assert.equal(restored.binding("123").workspace, "wrt");
    await reload.refresh(); assert.equal(events.length, 1);

    // Invalid batches, conflicting edits, removed paths and partial JSON keep
    // the last working configuration and never partially enable another topic.
    const invalid = [
      [{ ...topic, id: "124" }, { ...topic, ownerId: "999" }],
      [{ ...topic, id: "124" }, { ...topic, name: "changed" }],
      [{ ...topic, parentId: "999" }],
      [topic, topic],
    ];
    for (const batch of invalid) {
      await fs.writeFile(topicFile, JSON.stringify(batch)); await reload.refresh();
      assert.ok(reload.status.error); assert.equal(state.binding("124"), undefined);
      assert.equal(state.topics("2", "1")[0].name, "wrt");
    }
    await fs.writeFile(topicFile, "["); await reload.refresh(); assert.ok(reload.status.error);
    await fs.writeFile(topicFile, JSON.stringify([topic]));
    await fs.writeFile(workspacesFile, "{}"); await reload.refresh();
    assert.match(reload.status.error, /existing paths/); assert.equal(reload.current.wrt, dir);
    await fs.writeFile(workspacesFile, JSON.stringify({ wrt: dir })); await reload.refresh();
    assert.equal(reload.status.error, undefined);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("failed persistence never authorizes a new topic and a later reload retries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-reload-failure-"));
  try {
    const state = new StateStore(dir); await state.load();
    const file = path.join(dir, "topic-bindings.json");
    await fs.writeFile(file, JSON.stringify([{ id: "123", parentId: "2", guildId: "3", ownerId: "1", name: "wrt", workspace: "default" }]));
    const reload = new WorkspaceReloader({ projectDir: dir, stateDir: dir, allowedUsers: new Set(["1"]), allowedChannels: new Set(["2"]) }, state, () => {});
    await fs.mkdir(path.join(dir, "state.json.tmp"));
    await reload.refresh(); assert.ok(reload.status.error); assert.equal(state.binding("123"), undefined);
    await fs.rmdir(path.join(dir, "state.json.tmp"));
    await reload.refresh(); assert.equal(reload.status.error, undefined); assert.equal(state.binding("123").cwd, dir);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
