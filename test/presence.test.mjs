import assert from "node:assert/strict";
import test from "node:test";
import { ActivityType } from "discord.js";
import { PresencePublisher, initialPresence } from "../dist/presence.js";

test("startup presence never falls back to a bare Codex or host/project label", () => {
  const data = initialPresence({ node: "host", project: "wbot", slurmJobId: "" });
  assert.equal(data.activities[0].name,"限额：读取中");
});

test("reconnect and heartbeat republish the complete current state even when it is unchanged", () => {
  let now = 0; const sent = [];
  let data = { status: "online", activities: [{ name: "0 active/0 tasks · 限额：5h-80%", type: ActivityType.Playing }] };
  const publisher = new PresencePublisher(() => data, value => sent.push(value), () => {}, 5000, () => now);
  try {
    publisher.request(); assert.equal(sent.length,1);
    now = 10000; publisher.request(); assert.equal(sent.length,1);
    publisher.request(true); assert.equal(sent.length,2);
    data = { status: "dnd", activities: [{ name: "1 active/1 tasks · 限额：5h-79% · gpt-6.1-sol", type: ActivityType.Playing }] };
    now = 20000; publisher.request(true); assert.equal(sent.length,3);
    assert.match(sent.at(-1).activities[0].name,/gpt-6.1-sol/);
    assert.equal(publisher.lastPublished.label,data.activities[0].name);
    assert.equal(publisher.lastPublished.status,"dnd");
    publisher.stop(); now = 40000; publisher.request(true); assert.equal(sent.length,3);
  } finally { publisher.stop(); }
});

test("rapid task/metadata changes coalesce to the latest state within the presence rate limit", async () => {
  let name = "initial"; const sent = [];
  const publisher = new PresencePublisher(() => ({ activities: [{ name }] }), value => sent.push(value.activities[0].name), () => {}, 25);
  try {
    publisher.request();
    name = "stale-model"; publisher.request(true);
    name = "latest-model · 限额：5h-79%"; publisher.request();
    assert.deepEqual(sent,["initial"]);
    await new Promise(resolve => setTimeout(resolve,60));
    assert.deepEqual(sent,["initial","latest-model · 限额：5h-79%"]);
  } finally { publisher.stop(); }
});

test("offline and failed presence publication remain retryable without claiming delivery", () => {
  let ready = false; let fail = true; let attempts = 0;
  const publisher = new PresencePublisher(() => ready ? { activities: [{ name: "限额：5h-79%" }] } : undefined,
    () => { attempts++; if(fail)throw Error("Gateway unavailable"); }, () => {});
  try {
    publisher.request(true); assert.equal(attempts,0);
    ready = true; publisher.request(true); assert.equal(attempts,1); assert.equal(publisher.lastPublished,undefined);
    fail = false; publisher.request(true); assert.equal(attempts,2); assert.match(publisher.lastPublished.label,/限额/);
  } finally { publisher.stop(); }
});
