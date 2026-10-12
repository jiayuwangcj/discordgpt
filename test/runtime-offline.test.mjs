import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await sleep(10); }
  throw Error("Offline runtime condition timed out");
}

test("offline bot wiring: DM authorization, LLM parent routing, isolated models, slash status, FIFO stop and quota resume", { timeout: 12000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-bot-test-"));
  const previousSignals = Object.fromEntries(["SIGINT", "SIGTERM"].map((signal) => [signal, new Set(process.listeners(signal))]));
  const h = { replies: [], calls: [], notices: [], commands: [], turns: [], hold: false, quota: false };
  globalThis.__discordgptRuntimeTest = h;
  const fakeDiscord = path.join(dir, "discord.mjs");
  const fakeCodex = path.join(dir, "codex.mjs");
  const fakeConfig = path.join(dir, "config.mjs");
  const actualDiscord = pathToFileURL(path.resolve("node_modules/discord.js/src/index.js")).href;
  await fs.writeFile(fakeDiscord, `
import {EventEmitter} from 'node:events';
export * from ${JSON.stringify(actualDiscord)};
export class Client extends EventEmitter {
  constructor() { super(); const h=globalThis.__discordgptRuntimeTest; h.client=this;
    this.user={id:'bot',tag:'testbot',setPresence(){}};
    this.rest={setToken(){},post:async(route,{body})=>{h.notices.push({route,body});return {id:'dm'};}};
    this.application={commands:{create:async(data)=>{h.commands.push(data);return data;}}};
  }
  async login() { this.emit('clientReady'); }
  isReady(){return true;}
  destroy(){}
}
`);
  await fs.writeFile(fakeCodex, `
import {EventEmitter} from 'node:events';
export class CodexAppServer extends EventEmitter {
  constructor(){super();globalThis.__discordgptRuntimeTest.engine=this;}
  async start(){}
  async close(){}
  async startThread(){return 'thread-'+(++globalThis.__discordgptRuntimeTest.threadCount|| (globalThis.__discordgptRuntimeTest.threadCount=1));}
  async resumeThread(threadId,cwd,preserveModel){const h=globalThis.__discordgptRuntimeTest;h.calls.push({method:'resume',threadId,cwd,preserveModel});if(h.failResume)throw Error('resume failed');return h.sessions?.[threadId]?.settings;}
  threadMetadata(){return undefined;}
  async readThread(threadId){const h=globalThis.__discordgptRuntimeTest;if(h.readGate)await h.readGate;return h.sessions?.[threadId]??{status:{type:'idle'}};}
  async listThreads(cwd,query,cursor){const h=globalThis.__discordgptRuntimeTest;h.calls.push({method:'list',cwd,query,cursor});return {data:Object.values(h.sessions??{}).filter(t=>t.cwd===cwd&&(!query||(t.name??'').includes(query))),nextCursor:null};}
  async listModels(){return [{id:'test-one',model:'test-one',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium'}]}, {id:'test-two',model:'test-two',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]}];}
  async readUsage(){return {ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:25,windowDurationMins:300}}};}
  async readAccount(){return {account:{type:'chatgpt',planType:'pro'}};}
  async interrupt(threadId,turnId){const h=globalThis.__discordgptRuntimeTest;h.calls.push({method:'interrupt',threadId,turnId});h.release?.();}
  async steer(threadId,turnId,text){globalThis.__discordgptRuntimeTest.calls.push({method:'steer',threadId,turnId,text});}
  async runTurn(threadId,input,onStarted,onProgress,cwd,settings){const h=globalThis.__discordgptRuntimeTest;
    if(h.admissionQuota){h.admissionQuota=false;throw Error("usage limit reached");}
    const call={threadId,input,cwd,settings,turnId:'turn-'+(h.turns.length+1)};h.turns.push(call);onStarted(call.turnId);
    if(h.hold)await new Promise(resolve=>{h.release=resolve;});
    if(h.quota){h.quota=false;return {status:'failed',error:{message:'usage limit reached'},turnId:call.turnId,finalText:'',commentaryText:''};}
    return {status:'completed',turnId:call.turnId,finalText:'answer:'+input[0].text,commentaryText:''};
  }
}
`);
  await fs.writeFile(fakeConfig, `export const config=${JSON.stringify({ token: "test-token", projectDir: dir, stateDir: path.join(dir, "state"), sandbox: "workspace-write", approvalPolicy: "never", codexBin: "unused", requireMention: true, progressEnabled: false })};config.allowedUsers=new Set(['owner']);config.allowedChannels=new Set(['parent']);`);
  let source = await fs.readFile("dist/index.js", "utf8");
  source = source.replace(/from "\.\/([^"\n]+)"/g, (_, name) => `from ${JSON.stringify(pathToFileURL(path.resolve("dist", name)).href)}`);
  source = source.replace('from "discord.js"', `from ${JSON.stringify(pathToFileURL(fakeDiscord).href)}`)
    .replace(`from ${JSON.stringify(pathToFileURL(path.resolve("dist/config.js")).href)}`, `from ${JSON.stringify(pathToFileURL(fakeConfig).href)}`)
    .replace(`from ${JSON.stringify(pathToFileURL(path.resolve("dist/codex-app-server.js")).href)}`, `from ${JSON.stringify(pathToFileURL(fakeCodex).href)}`);
  // Expose test cleanup only; execute the compiled production routing unchanged.
  source += "\nexport {queues,state,catalog};export function stopTestTimers(){for(const timer of [refreshTimer,healthTimer,presenceTimer])if(timer)clearInterval(timer);}\n";
  const main = path.join(dir, "main.mjs"); await fs.writeFile(main, source);
  let runtime;
  let id = 0;
  const channel = (channelId, guild = false) => ({ id: channelId, type: guild ? 0 : 1, isThread: () => false, sendTyping: async () => {} });
  const emit = (content, channelId = "dm", guild = false, userId = "owner") => {
    const message = { id: String(++id), channelId, guildId: guild ? "guild" : null, guild: guild ? {} : null,
      channel: channel(channelId, guild), author: { id: userId, bot: false }, content, attachments: new Map(), mentions: { has: () => true },
      reply: async (value) => {
        const payload = typeof value === "string" ? { content: value } : value;
        if (h.failReply && payload.content.startsWith("answer:")) { h.failReply = false; throw Error("HTTP 429"); }
        h.replies.push({ channelId, ...payload });
        return { id: "card-"+id, edit: async () => {} };
      } };
    h.client.emit("messageCreate", message); return message;
  };
  const slash = (name, options = {}, channelId = "dm", userId = "owner") => {
    const replies = [];
    const interaction = { channelId, guildId: null, channel: channel(channelId), user: { id: userId }, commandName: name,
      isChatInputCommand: () => true, isButton: () => false, isAutocomplete: () => false,
      options: { getString: (key) => options[key] ?? null }, replied: false,
      deferReply: async () => {}, reply: async (value) => replies.push(value),
      editReply: async (value) => { interaction.replied = true; replies.push(typeof value === "string" ? { content: value } : value); },
      followUp: async (value) => replies.push(value),
    };
    h.client.emit("interactionCreate", interaction); return replies;
  };
  try {
    runtime = await import(pathToFileURL(main).href);
    await until(() => h.commands.length === 17 && !runtime.catalog.stale);
    assert.equal(h.notices.filter((n) => n.body.content?.includes("已上线")).length, 1);
    emit("forbidden", "dm", false, "intruder");
    emit("列出我的工作区和话题", "parent", true);
    const dmManagement = emit("DM management task");
    h.client.emit("messageCreate", dmManagement); // Reconnect replay must not execute twice.
    await until(() => h.turns.length === 2 && runtime.queues.list().length === 0);
    assert.ok(h.turns.some((t) => t.input[0].text === "列出我的工作区和话题"));
    assert.ok(h.turns.some((t) => t.input[0].text === "DM management task"));
    assert.ok(!h.turns.some((t) => t.input[0].text === "forbidden"));
    const modelReply = slash("model", { model: "test-two", effort: "high" });
    await until(() => modelReply.length > 0);
    assert.match(modelReply[0].content, /已保存下一轮模型/);
    emit("next DM"); emit("next parent", "parent", true);
    await until(() => h.turns.length === 4 && runtime.queues.list().length === 0);
    assert.equal(h.turns.find((t) => t.input[0].text === "next DM").settings.model, "test-two");
    assert.equal(h.turns.find((t) => t.input[0].text === "next parent").settings, undefined);
    const invalid = slash("model", { model: "test-two", effort: "ultra" });
    await until(() => invalid.length > 0); assert.match(invalid[0].content, /原设置保留/);
    const status = slash("status"); await until(() => status.length > 0);
    assert.match(status[0].content, /5h-75%/); assert.match(status[0].content, /test-two/);
    const unauthorized = slash("status", {}, "dm", "intruder"); await until(() => unauthorized.length > 0);
    assert.match(unauthorized[0].content, /未授权/);
    h.hold = true; emit("long task"); await until(() => h.turns.length === 5);
    emit("cancelled task"); await until(() => runtime.queues.list().length === 2);
    const cancel = slash("cancel"); await until(() => cancel.length > 0);
    assert.match(cancel[0].content, /已取消/);
    const steer = slash("steer", { text: "focus tests" }); await until(() => steer.length > 0);
    assert.equal(h.calls.at(-1).method, "steer");
    const stop = slash("stop"); await until(() => stop.length > 0 && runtime.queues.list().length === 0);
    assert.ok(h.calls.some((c) => c.method === "interrupt"));
    assert.ok(!h.turns.some((t) => t.input[0].text === "cancelled task"));
    h.hold = false; h.quota = true; emit("quota task");
    await until(() => runtime.queues.list()[0]?.phase === "paused");
    assert.ok(h.replies.some((r) => r.content.includes("额度不足")));
    const resume = slash("resume"); await until(() => resume.length > 0 && runtime.queues.list().length === 0);
    assert.match(h.turns.at(-1).input[0].text, /继续上一次/);
    assert.equal(h.turns.at(-1).threadId, h.turns.find((t) => t.input[0].text === "quota task").threadId);
    h.admissionQuota = true; emit("admission quota task");
    await until(() => runtime.queues.list()[0]?.phase === "paused");
    const retryAdmission = slash("resume"); await until(() => retryAdmission.length > 0 && runtime.queues.list().length === 0);
    assert.equal(h.turns.at(-1).input[0].text, "admission quota task");
    const noticeCount = h.replies.length;
    h.failReply = true; emit("delivery failure task");
    await until(() => runtime.queues.list().length === 0 && h.replies.length > noticeCount);
    assert.equal(h.turns.filter((t) => t.input[0].text === "delivery failure task").length, 1);
    assert.ok(!h.replies.slice(noticeCount).some((r) => r.content.includes("额度不足")));

    const saved = "019abcde-1234-7000-8000-123456789abc";
    const foreign = "019abcde-1234-7000-8000-123456789abd";
    h.sessions = {
      [saved]: { id: saved, cwd: dir, name: "之前讨论的开发方案", updatedAt: 1700000000, status: { type: "notLoaded" }, settings: { model: "test-two", effort: "high" } },
      [foreign]: { id: foreign, cwd: "/other-project", name: "其他工程的私密会话", status: { type: "idle" } },
    };
    const sessions = slash("sessions", { query: "开发方案", cursor: "page-2" });
    await until(() => sessions.length > 0);
    assert.match(sessions[0].content, /之前讨论的开发方案/);
    assert.ok(!sessions[0].content.includes("其他工程"));
    assert.equal(h.calls.filter(c=>c.method==="list").at(-1).cursor,"page-2");
    const choices = [];
    h.client.emit("interactionCreate", { commandName: "bind", channel: channel("dm"), channelId: "dm", guildId: null, user: { id: "owner" },
      isChatInputCommand: () => false, isButton: () => false, isAutocomplete: () => true,
      options: { getFocused: () => "开发方案" }, respond: async value => choices.push(value) });
    await until(() => choices.length > 0);
    assert.equal(choices[0][0].value, saved); assert.match(choices[0][0].name, /之前讨论/);
    const turnsBeforeBinding = h.turns.length;
    const threadsBeforeBinding = h.threadCount;
    const old = runtime.state.get("dm");
    const wrongWorkspace = slash("bind", { thread: foreign });
    await until(() => wrongWorkspace.length > 0);
    assert.match(wrongWorkspace[0].content, /其他工程/);
    assert.equal(runtime.state.get("dm"), old);
    h.sessions[saved].status = { type: "active" };
    const running = slash("bind", { thread: saved });
    await until(() => running.length > 0); assert.match(running[0].content, /正在运行/);
    assert.equal(runtime.state.get("dm"), old);
    h.sessions[saved].status = { type: "idle" }; h.failResume = true;
    const failed = slash("bind", { thread: saved });
    await until(() => failed.length > 0); assert.match(failed[0].content, /当前绑定未改变/);
    assert.equal(runtime.state.get("dm"), old); h.failResume = false;
    const attached = slash("bind", { thread: saved });
    await until(() => attached.length > 0); assert.match(attached[0].content, /已绑定已有/);
    assert.equal(runtime.state.get("dm"), saved);
    assert.equal(h.turns.length, turnsBeforeBinding); assert.equal(h.threadCount, threadsBeforeBinding);
    emit("继续之前讨论的方案");
    await until(() => h.turns.length === turnsBeforeBinding + 1 && runtime.queues.list().length === 0);
    assert.equal(h.turns.at(-1).threadId, saved);
    assert.deepEqual(h.turns.at(-1).settings, { model: "test-two", effort: "high" });
    const attachedOther = slash("bind", { thread: saved }, "dm-other");
    await until(() => attachedOther.length > 0);
    h.hold = true; emit("共享会话第一窗口"); await until(() => runtime.queues.list().length === 1);
    emit("共享会话第二窗口", "dm-other"); await until(() => runtime.queues.list().length === 2);
    assert.equal(new Set(runtime.queues.list().map(t=>t.key)).size, 1);
    assert.equal(runtime.queues.list().filter(t=>t.phase==="running").length, 1);
    const busyBinding = slash("bind", { thread: saved });
    await until(() => busyBinding.length > 0); assert.match(busyBinding[0].content, /暂停任务/);
    const stopShared = slash("stop"); await until(() => stopShared.length > 0 && h.turns.at(-1).input[0].text === "共享会话第二窗口");
    h.hold = false; h.release(); await until(() => runtime.queues.list().length === 0);
    const selectedShared = slash("model", { model: "test-one", effort: "medium" }, "dm-other");
    await until(() => selectedShared.length > 0);
    assert.equal(runtime.state.settings("thread:"+saved).model,"test-one");
    const reset = slash("reset"); await until(() => reset.length > 0);
    assert.equal(runtime.state.get("dm"), undefined); assert.equal(runtime.state.get("dm-other"), saved);
    assert.equal(runtime.state.settings("dm").model, "test-one");
    // A task arriving during the async binding must not use the old queue key.
    let unlock; h.readGate = new Promise(resolve=>{unlock=resolve;});
    const switching = slash("bind", { thread: saved });
    await until(() => h.calls.filter(c=>c.method==="resume").length > 0 && !switching.length);
    await sleep(10); const beforeGate = h.turns.length;
    const unrelatedStatus = slash("status", {}, "dm-unrelated");
    await until(() => unrelatedStatus.length > 0);
    assert.match(unrelatedStatus[0].content, /服务正常/);
    emit("不能在切换中提交", "dm-other"); await until(() => h.replies.some(r=>r.content.includes("正在切换会话绑定")));
    assert.equal(h.turns.length, beforeGate);
    emit("绑定之后立即继续");
    h.readGate = undefined; unlock(); await until(() => switching.length > 0);
    await until(() => h.turns.length === beforeGate + 1 && runtime.queues.list().length === 0);
    assert.equal(h.turns.at(-1).threadId, saved);
    const publicReplies = h.replies.length;
    emit("!codex sessions", "parent", true); await until(() => h.replies.length > publicReplies);
    assert.match(h.replies.at(-1).content, /仅你可见/);
    assert.ok(!h.replies.at(-1).content.includes("之前讨论的开发方案"));
  } finally {
    runtime?.stopTestTimers();
    for (const signal of ["SIGINT", "SIGTERM"]) for (const listener of process.listeners(signal)) if (!previousSignals[signal].has(listener)) process.removeListener(signal, listener);
    delete globalThis.__discordgptRuntimeTest;
    // Allow any already-admitted health write to settle before deleting state.
    await sleep(20); await fs.rm(dir, { recursive: true, force: true });
  }
});
