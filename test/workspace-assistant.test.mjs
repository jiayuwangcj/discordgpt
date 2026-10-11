import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceAssistant, parseManagement, matchWorkspace } from "../dist/workspace-assistant.js";

test("bounded Chinese management requests recognize explicit intent and preserve topic names", () => {
  assert.deepEqual(parseManagement("给 wbot 开一个话题，叫交易开发"), { kind: "create", query: "wbot", name: "交易开发" });
  assert.deepEqual(parseManagement("再建一个 wbot 话题"), { kind: "create", query: "wbot", name: undefined });
  assert.deepEqual(parseManagement("新建 discordgpt 话题，叫聊天开发"), { kind: "create", query: "discordgpt", name: "聊天开发" });
  assert.deepEqual(parseManagement("打开聊天机器人项目"), { kind: "open", query: "聊天机器人项目" });
  assert.deepEqual(parseManagement("列出我的工作区和话题"), { kind: "list" });
  assert.equal(parseManagement("分析代码，然后给 wbot 创建话题"), undefined);
  assert.equal(parseManagement("删除交易开发"), undefined);
  assert.equal(parseManagement("重置全部上下文"), undefined);
  assert.deepEqual(matchWorkspace("wbot2", ["wbot"]), []);
  assert.deepEqual(matchWorkspace("聊天机器人项目", ["discordgpt"]), ["discordgpt"]);
});

function fixture() {
  const topics = [];
  const opened = [];
  const tools = {
    workspaces: () => ["wbot", "discordgpt"], topics: () => topics,
    create: async (workspace, name) => {
      const topic = { id: String(topics.length + 1), workspace, name };
      topics.push(topic); return topic;
    },
    open: async (topic) => { opened.push(topic.id); },
  };
  return { tools, topics, opened, assistant: new WorkspaceAssistant() };
}

test("open creates once, reuses its entry, and same-name create does not fork context", async () => {
  const f = fixture();
  assert.match(await f.assistant.respond("user", "给 wbot 开一个话题，叫交易开发", f.tools), /已创建.*<#1>/);
  assert.match(await f.assistant.respond("user", "打开 wbot", f.tools), /打开话题.*<#1>/);
  assert.match(await f.assistant.respond("user", "给 wbot 开一个话题，叫交易开发", f.tools), /同名话题已存在/);
  assert.equal(f.topics.length, 1);
  assert.deepEqual(f.opened, ["1"]);
  await f.assistant.respond("user", "再建一个 wbot 话题", f.tools);
  assert.equal(f.topics.length, 2);
  assert.match(await f.assistant.respond("user", "打开 wbot", f.tools), /请选择话题/);
  assert.match(await f.assistant.respond("user", "打开交易开发", f.tools), /<#1>/);
});

test("clarification stays scoped to one user/channel, retains the requested name, and can cancel", async () => {
  const f = fixture();
  assert.match(await f.assistant.respond("a", "创建一个项目话题，叫修复", f.tools), /请明确选择/);
  assert.equal(await f.assistant.respond("b", "wbot", f.tools), undefined);
  assert.match(await f.assistant.respond("a", "wbot", f.tools), /已创建/);
  assert.equal(f.topics[0].name, "修复");
  assert.match(await f.assistant.respond("a", "打开 wbot 和 discordgpt", f.tools), /请明确选择/);
  assert.equal(await f.assistant.respond("a", "取消", f.tools), "已取消。");
  assert.equal(f.topics.length, 1);
});

test("lists use tools and never execute arbitrary paths, destructive actions or oversized names", async () => {
  const f = fixture();
  assert.match(await f.assistant.respond("u", "打开 /etc", f.tools), /请明确选择/);
  assert.match(await f.assistant.respond("u", "给 wbot 开一个话题，叫" + "字".repeat(101), f.tools), /不能超过/);
  assert.equal(f.topics.length, 0);
  assert.equal(await f.assistant.respond("u", "删除所有话题", f.tools), undefined);
  assert.match(await f.assistant.respond("u", "列出我的工作区和话题", f.tools), /工作区：wbot、discordgpt/);
});

test("expired clarification does not turn a later ordinary message into a management action", async (t) => {
  const f = fixture();
  let now = 0;
  t.mock.method(Date, "now", () => now);
  await f.assistant.respond("u", "打开项目", f.tools);
  now = 5 * 60_000 + 1;
  assert.equal(await f.assistant.respond("u", "wbot", f.tools), undefined);
  assert.equal(f.topics.length, 0);
});
