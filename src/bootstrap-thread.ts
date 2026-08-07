import { CodexAppServer } from "./codex-app-server.js";

const [url, cwd, sandbox = "workspace-write", approvalPolicy = "never", model = "", existingThread = ""] = process.argv.slice(2);
if (!url || !cwd) {
  console.error("Usage: bootstrap-thread APP_SERVER_URL PROJECT_DIR [SANDBOX] [APPROVAL_POLICY] [MODEL]");
  process.exit(2);
}

const server = new CodexAppServer("unused", cwd, {
  model: model || undefined,
  sandbox,
  approvalPolicy,
}, { url, token: process.env.CODEX_APP_SERVER_TOKEN || undefined });

try {
  await server.start();
  let threadId = existingThread;
  if (threadId) {
    try { await server.resumeThread(threadId); }
    catch { threadId = ""; }
  }
  if (!threadId) {
    threadId = await server.startThread();
    // A newly started app-server thread has no resumable rollout until its first
    // turn is persisted. Seed it once so `codex resume --remote THREAD_ID` works.
    await server.runTurn(
      threadId,
      "Initialize this Codex Discord session. Reply only: Ready.",
    );
  }
  process.stdout.write(`${threadId}\n`);
  await server.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
