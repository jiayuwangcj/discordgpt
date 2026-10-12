import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServer } from "../dist/codex-app-server.js";
import { quotaError } from "../dist/usage.js";

// Feed encoded JSON-RPC frames through the production request/event handlers.
// OS pipe/socket acceptance is covered separately by smoke/runtime tests.
function create(defaults = { model: "default-model", sandbox: "workspace-write", approvalPolicy: "never" }) {
  const server = new CodexAppServer("unused", process.cwd(), defaults);
  let turn = 0;
  server.send = (request) => {
    queueMicrotask(() => {
      const frame = (value) => server.onLine(JSON.stringify(value));
      const result = (value) => frame({ id: request.id, result: value });
      switch (request.method) {
        case "initialize": return result({});
        case "initialized": return;
        case "model/list": return result({ data: [{ model: request.params.cursor ? "model-two" : "model-one" }], nextCursor: request.params.cursor ? null : "page-two" });
        case "account/read": return result({ account: { type: "chatgpt" } });
        case "account/rateLimits/read": return result({ rateLimits: { primary: { usedPercent: 25 } } });
        case "thread/start": return result({ thread: { id: "thread-test" } });
        case "thread/list": return result({ data: [{ id: "listed", cwd: request.params.cwd, name: request.params.searchTerm }, { id: "foreign", cwd: "/foreign" }], nextCursor: "thread-page-two" });
        case "thread/resume": return result({});
        case "thread/read": return result({ thread: { status: { type: "idle" } } });
        case "turn/steer": return result({ turnId: request.params.expectedTurnId });
        case "turn/interrupt": return result({});
        case "turn/start": {
          const id = `turn-${++turn}`;
          const fail = request.params.input[0].text === "quota";
          frame({ method: "item/agentMessage/delta", params: { turnId: id, delta: JSON.stringify({ model: request.params.model, effort: request.params.effort, cwd: request.params.cwd }) } });
          frame({ method: "turn/completed", params: { turn: { id, status: fail ? "failed" : "completed", error: fail ? { message: "usage limit reached", codexErrorInfo: "usageLimitExceeded" } : null } } });
          return result({ turn: { id } });
        }
        default: throw Error(`Unexpected method ${request.method}`);
      }
    });
  };
  // Avoid spawning a process in this in-memory protocol test.
  server.startStdio = () => {};
  return server;
}

test("encoded control protocol paginates catalog, reads limits, steers and applies model/effort without dropping context", async () => {
  const server = create();
  try {
    await server.start();
    const models = await server.listModels();
    assert.deepEqual(models.map((m) => m.model), ["model-one", "model-two"]);
    assert.equal((await server.readUsage()).rateLimits.primary.usedPercent, 25);
    assert.equal((await server.readAccount()).account.type, "chatgpt");
    const thread = await server.startThread(); await server.resumeThread(thread);
    assert.equal((await server.readThread(thread)).status.type, "idle");
    const first = await server.runTurn(thread, "first", undefined, undefined, "/workspace/a", { model: "model-one", effort: "medium" });
    assert.deepEqual(JSON.parse(first.finalText), { model: "model-one", effort: "medium", cwd: "/workspace/a" });
    const second = await server.runTurn(thread, "second", undefined, undefined, "/workspace/b", { model: "model-two", effort: "high" });
    assert.equal(JSON.parse(second.finalText).model, "model-two");
    assert.notEqual(first.turnId, second.turnId);
    await server.steer(thread, second.turnId, "new direction");
    await server.interrupt(thread, second.turnId);
  } finally { await server.close(); }
});

test("YOLO permissions are sent for both new and bound threads and unattended turns", async () => {
  const server = create({ sandbox: "danger-full-access", approvalPolicy: "never" });
  const requests = [];
  const send = server.send.bind(server);
  server.send = value => { requests.push(value); send(value); };
  try {
    await server.start();
    const created = await server.startThread("/project");
    await server.resumeThread("existing-thread", "/project", true);
    await server.runTurn(created, "continue", undefined, undefined, "/project");
    for (const method of ["thread/start", "thread/resume"]) {
      const request = requests.find(r=>r.method===method);
      assert.equal(request.params.sandbox,"danger-full-access");
      assert.equal(request.params.approvalPolicy,"never");
    }
    assert.equal(requests.find(r=>r.method==="turn/start").params.approvalPolicy,"never");
  } finally { await server.close(); }
});

test("existing-session protocol scopes discovery to cwd and resumes without overriding the saved model", async () => {
  const server = create();
  const requests = [];
  const send = server.send.bind(server);
  server.send = value => { requests.push(value); send(value); };
  try {
    await server.start();
    const page = await server.listThreads("/workspace", "previous plan", "page-one");
    assert.deepEqual(page.data.map(t=>t.id), ["listed"]);
    assert.equal(page.nextCursor, "thread-page-two");
    const request = requests.find(r=>r.method==="thread/list");
    assert.equal(request.params.searchTerm,"previous plan");
    assert.equal(request.params.sortKey,"updated_at");
    assert.equal(request.params.cursor,"page-one");
    await server.resumeThread("listed", "/workspace", true);
    const resume = requests.find(r=>r.method==="thread/resume");
    assert.equal(Object.hasOwn(resume.params,"model"),false);
    assert.equal(resume.params.sandbox,"workspace-write");
    assert.equal(resume.params.approvalPolicy,"never");
    assert.ok(!requests.some(r=>r.method==="thread/start"));
  } finally { await server.close(); }
});

test("failed early turn keeps structured quota error and is never reported as completed", async () => {
  const server = create();
  try {
    await server.start();
    const thread = await server.startThread();
    const result = await server.runTurn(thread, "quota");
    assert.equal(result.status, "failed");
    assert.equal(result.error.codexErrorInfo, "usageLimitExceeded");
    assert.equal(quotaError(result.error), true);
  } finally { await server.close(); }
});
