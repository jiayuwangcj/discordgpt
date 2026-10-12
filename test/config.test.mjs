import assert from "node:assert/strict";
import test from "node:test";

test("instance defaults use YOLO while explicit permissions retain precedence", async () => {
  const values = {
    DISCORD_BOT_TOKEN: "test-token", CODEX_PROJECT_DIR: "/tmp", DISCORD_ALLOWED_USER_IDS: "owner",
    CODEX_DISCORD_ENV_FILE: "/tmp/discordgpt-config-test-missing.env", CODEX_APP_SERVER_URL: undefined,
    CODEX_SANDBOX: undefined, CODEX_APPROVAL_POLICY: undefined,
    DISCORD_INTERACTIONS_PORT: undefined,
  };
  const previous = Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  const set = (key,value) => { if(value===undefined)delete process.env[key];else process.env[key]=value; };
  try {
    for (const [key,value] of Object.entries(values)) set(key,value);
    const defaults = (await import("../dist/config.js?permissions-defaults")).config;
    assert.equal(defaults.sandbox,"danger-full-access"); assert.equal(defaults.approvalPolicy,"never");
    set("CODEX_SANDBOX","workspace-write");set("CODEX_APPROVAL_POLICY","on-request");
    const restricted = (await import("../dist/config.js?permissions-explicit")).config;
    assert.equal(restricted.sandbox,"workspace-write"); assert.equal(restricted.approvalPolicy,"on-request");
  } finally { for(const [key,value] of Object.entries(previous))set(key,value); }
});
