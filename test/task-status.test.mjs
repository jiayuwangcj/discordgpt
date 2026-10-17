import assert from "node:assert/strict";
import test from "node:test";
import { startTyping } from "../dist/notifications.js";
import { TaskStatusCard } from "../dist/task-status.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = () => new Promise(resolve => setImmediate(resolve));

test("typing renews during long work, ignores REST failures and stops after task cleanup", async () => {
  let sends = 0;
  const stop = startTyping(async () => { sends++; if (sends === 1) throw Error("Discord unavailable"); }, 8);
  try {
    await sleep(40); assert.ok(sends >= 3);
    stop(); const finished = sends;
    await sleep(25); assert.equal(sends, finished);
  } finally { stop(); }
});

test("typing never overlaps a slow REST request", async () => {
  let sends = 0; let release;
  const stop = startTyping(() => { sends++; return new Promise(resolve => { release = resolve; }); }, 5);
  try {
    await sleep(25); assert.equal(sends, 1);
    stop(); release(); await sleep(15); assert.equal(sends, 1);
  } finally { stop(); }
});

test("an in-topic card advances from queued to working to paused and removes controls on completion", async () => {
  const edits = []; const registered = [];
  const card = new TaskStatusCard("queued", async content => {
    edits.push({ content }); return { id: "card", edit: async payload => { edits.push(payload); } };
  }, id => registered.push(id));
  card.show(); await flush(); assert.match(edits.at(-1).content, /排队/);
  card.setDetails("模型：model-a · high\n限额：5h-49%");
  card.update("running"); await flush(); assert.match(edits.at(-1).content, /工作中/);
  assert.match(edits.at(-1).content,/model-a · high\n限额：5h-49%/);
  card.update("paused"); await flush(); assert.match(edits.at(-1).content, /暂停/);
  card.update("running"); await flush(); assert.match(edits.at(-1).content, /工作中/);
  await card.finish("completed"); assert.match(edits.at(-1).content, /已结束/);
  assert.deepEqual(edits.at(-1).components, []); assert.deepEqual(registered, ["card"]);
  card.update("running"); await flush(); assert.match(edits.at(-1).content, /已结束/);
});

test("late initial card delivery cannot resurrect a cancelled task or its controls", async () => {
  let deliver; const edits = []; const registered = [];
  const card = new TaskStatusCard("queued", () => new Promise(resolve => { deliver = resolve; }), id => registered.push(id));
  card.show(); await flush(); card.update("running");
  const done = card.finish("cancelled");
  deliver({ id: "late-card", edit: async payload => { edits.push(payload); } });
  await done;
  assert.match(edits.at(-1).content, /取消/); assert.deepEqual(edits.at(-1).components, []);
  assert.deepEqual(registered, []);
});

test("status-card creation and edit failures do not reject task completion", async () => {
  const failedCreate = new TaskStatusCard("running", async () => { throw Error("HTTP 403"); }, () => {}, () => {});
  failedCreate.show(); await failedCreate.finish("failed");
  const failedEdit = new TaskStatusCard("running", async () => ({ id: "card", edit: async () => { throw Error("HTTP 429"); } }), () => {}, () => {});
  failedEdit.show(); await failedEdit.finish("completed");
});
