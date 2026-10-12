import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { interactionHandler, ownsInteraction } from "../dist/interactions-http.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const keyHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
async function request(handler, payload, changes = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const req = Readable.from([body]); req.method = "POST";
  req.headers = { "x-signature-ed25519": sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString("hex"), "x-signature-timestamp": timestamp, ...changes };
  const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(text) { this.payload = JSON.parse(text); } };
  await handler(req, res); return res;
}

test("signed ingress handles Discord ping and chat commands but preserves non-chat button routing", async () => {
  const dispatched = [];
  let forwarded;
  const handler = interactionHandler(keyHex, async (payload, respond) => { dispatched.push(payload); respond({ type: 5, data: { flags: 64 } }); },
    "https://example.com/original", async (url, options) => { forwarded = { url, options }; return new Response(JSON.stringify({ type: 4, data: { content: "trade action" } })); });
  assert.deepEqual((await request(handler, { type: 1 })).payload, { type: 1 });
  const slash = { type: 2, data: { name: "model" }, id: "interaction", token: "PRIVATE" };
  assert.equal((await request(handler, slash)).payload.type, 5);
  assert.equal((await request(handler, slash)).payload.type, 5);
  assert.equal(dispatched.length, 1);
  const other = { type: 3, data: { custom_id: "trade:confirm" } };
  assert.equal((await request(handler, other)).payload.data.content, "trade action");
  assert.equal(forwarded.url, "https://example.com/original");
  assert.deepEqual(JSON.parse(forwarded.options.body.toString()), other);
  assert.ok(forwarded.options.headers["x-signature-ed25519"]);
  assert.equal(forwarded.options.headers["User-Agent"], "DiscordBot (https://discord.com, v1.0)");
  await request(handler, other, { "user-agent": "DiscordBot (https://discord.com, v1.0) ingress" });
  assert.equal(forwarded.options.headers["User-Agent"], "DiscordBot (https://discord.com, v1.0) ingress");
  assert.equal(ownsInteraction({ type: 3, data: { custom_id: "task:stop:123" } }), true);
});

test("HTTP ingress rejects invalid or expired signatures before executing controls", async () => {
  const handler = interactionHandler(keyHex, async () => assert.fail("Unauthenticated dispatch"));
  assert.equal((await request(handler, { type: 2, data: { name: "stop" } }, { "x-signature-ed25519": "0".repeat(128) })).status, 401);
  assert.equal((await request(handler, { type: 2, data: { name: "stop" } }, { "x-signature-timestamp": "1" })).status, 401);
  assert.throws(() => interactionHandler("bad", async () => {}));
  assert.throws(() => interactionHandler(keyHex, async () => {}, "http://example.com"));
});
