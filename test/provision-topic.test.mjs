import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const exec = promisify(execFile);

test("topic provisioning stages validated host config without editing live state or requesting a drain", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-provision-"));
  try {
    const workspaces = path.join(root, "workspaces.json");
    const stateFile = path.join(root, "state.json");
    const original = JSON.stringify({ threads: { busy: "live-thread" }, settings: { busy: { model: "active-model" } } });
    await fs.writeFile(stateFile, original);
    await fs.writeFile(workspaces, JSON.stringify({ existing: root }));
    const env = { DISCORD_BOT_TOKEN: "fake-token", DISCORD_ALLOWED_USER_IDS: "1", DISCORD_ALLOWED_CHANNEL_IDS: "2", CODEX_DISCORD_STATE_DIR: root, CODEX_PROJECT_DIR: root, CODEX_WORKSPACES_FILE: workspaces };
    await fs.writeFile(path.join(root, "discordgpt.env"), Object.entries(env).map(([key, value]) => key + "=" + JSON.stringify(value)).join("\n"));
    const preload = path.join(root, "fake-api.mjs");
    await fs.writeFile(preload, `globalThis.fetch=async()=>new Response(JSON.stringify({id:'123',type:12,parent_id:'2',guild_id:'3',name:'wrt'}));`);
    const args = ["--import", preload, "scripts/bind-workspace-topic.mjs", "123", "wrt", root, "1", "--root", root, "--stage"];
    const result = await exec(process.execPath, args);
    assert.equal(JSON.parse(result.stdout).status, "staged");
    assert.deepEqual(JSON.parse(await fs.readFile(workspaces, "utf8")), { existing: root, wrt: root });
    assert.equal(JSON.parse(await fs.readFile(path.join(root, "topic-bindings.json"), "utf8"))[0].workspace, "wrt");
    await exec(process.execPath, args); // Idempotent retry does not duplicate bindings.
    assert.equal(JSON.parse(await fs.readFile(path.join(root, "topic-bindings.json"), "utf8")).length, 1);
    await fs.mkdir(path.join(root, "workspace-config.lock"));
    await assert.rejects(exec(process.execPath, args));
    assert.equal(await fs.readFile(stateFile, "utf8"), original);
    await assert.rejects(fs.access(path.join(root, "drain")), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
