import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexAppServer } from "./codex-app-server.js";
import { StateStore } from "./state.js";

// Starts the installed Codex app-server and performs initialize/initialized.
// No Discord login, model turn, or modification of an existing thread.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "discordgpt-smoke-"));
const server = new CodexAppServer(process.env.CODEX_BIN || "codex", dir, {
  sandbox: "workspace-write", approvalPolicy: "never",
});
const deadline = setTimeout(() => process.exit(1), 30000);
try {
  const store = new StateStore(dir);
  await store.load();
  await Promise.all([store.set("smoke-a", "thread-a"), store.set("smoke-b", "thread-b")]);
  const restored = new StateStore(dir);
  await restored.load();
  if (restored.get("smoke-a") !== "thread-a" || restored.get("smoke-b") !== "thread-b") {
    throw new Error("State roundtrip failed");
  }
  await server.start();
  console.log("PASS: standalone Codex app-server initialized; concurrent state writes restored");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await server.close();
  clearTimeout(deadline);
  await fs.rm(dir, { recursive: true, force: true });
}
