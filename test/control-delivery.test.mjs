import assert from "node:assert/strict";
import test from "node:test";
import { ChannelQueue } from "../dist/channel-queue.js";
import { executeControl, retryEditReply } from "../dist/control-delivery.js";

test("a delayed model confirmation cannot block STOP or another control in the same topic", async () => {
  const queue = new ChannelQueue(); let release; let started;
  const delivering = new Promise(resolve => { started = resolve; });
  const saved = [];
  const first = executeControl(queue, "wbot", async reply => { saved.push("model"); await reply("saved"); return true; },
    () => { started(); return new Promise(resolve => { release = resolve; }); }, () => {});
  await delivering;
  await executeControl(queue, "wbot", async reply => { saved.push("stop"); await reply("stopped"); return true; }, async () => {}, () => {});
  assert.deepEqual(saved, ["model", "stop"]); release(); await first;
});

test("TLS acknowledgement retry never re-executes the model change", async () => {
  let mutations = 0; let deliveries = 0;
  const result = await executeControl(new ChannelQueue(), "wbot", async reply => { mutations++; await reply("model saved"); return true; },
    () => retryEditReply(async () => {
      deliveries++; if (deliveries < 3) throw Object.assign(Error("TLS"), { code: "ERR_SSL_PACKET_LENGTH_TOO_LONG" });
    }, async () => {}), () => assert.fail("delivery should recover"));
  assert.equal(result, true); assert.equal(mutations, 1); assert.equal(deliveries, 3);
});

test("permanent confirmation failure retains a successful result and releases the control queue", async () => {
  const queue = new ChannelQueue(); let failures = 0;
  const result = await executeControl(queue, "wbot", async reply => { await reply("saved"); return true; },
    async () => { throw Error("HTTP 403"); }, () => { failures++; });
  assert.equal(result, true); assert.equal(failures, 1);
  await queue.enqueue("wbot", async () => {});
  let attempts = 0;
  await assert.rejects(retryEditReply(async () => { attempts++; throw Error("HTTP 403"); }, async () => {}), /403/);
  assert.equal(attempts, 1);
});

test("state mutation errors still propagate and do not send success confirmations", async () => {
  let sent = 0;
  await assert.rejects(executeControl(new ChannelQueue(), "wbot", async () => { throw Error("disk full"); },
    async () => { sent++; }, () => {}), /disk full/);
  assert.equal(sent, 0);
});
