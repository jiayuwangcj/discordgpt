import path from "node:path";
import dotenv from "dotenv";

// Deliberately load only an explicit instance file or this repository's .env.
// Never search for or source ~/.env.
dotenv.config({ path: process.env.CODEX_DISCORD_ENV_FILE || path.resolve(".env"), quiet: true });

function csv(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((x) => x.trim()).filter(Boolean));
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

const projectDir = path.resolve(process.env.CODEX_PROJECT_DIR ?? "");
if (!process.env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!process.env.CODEX_PROJECT_DIR) throw new Error("CODEX_PROJECT_DIR is required");
if (!csv(process.env.DISCORD_ALLOWED_USER_IDS).size) throw new Error("DISCORD_ALLOWED_USER_IDS must include at least one user");
if (process.env.CODEX_APP_SERVER_URL) {
  const endpoint = new URL(process.env.CODEX_APP_SERVER_URL);
  if (!((endpoint.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))
      || (endpoint.protocol === "wss:" && process.env.CODEX_APP_SERVER_TOKEN))) {
    throw new Error("CODEX_APP_SERVER_URL requires loopback ws:// or authenticated wss://");
  }
}
if (!["read-only", "workspace-write", "danger-full-access"].includes(process.env.CODEX_SANDBOX || "danger-full-access")) {
  throw new Error("Unsupported CODEX_SANDBOX");
}

const interactionPort = Number(process.env.DISCORD_INTERACTIONS_PORT || 0);
if (!Number.isInteger(interactionPort) || interactionPort < 0 || interactionPort > 65535) throw new Error("Invalid interactions port");
if (interactionPort && !/^[a-f0-9]{64}$/i.test(process.env.DISCORD_PUBLIC_KEY || "")) throw new Error("HTTP interactions require DISCORD_PUBLIC_KEY");

export const config = {
  token: process.env.DISCORD_BOT_TOKEN,
  interactionPort,
  interactionPublicKey: process.env.DISCORD_PUBLIC_KEY || "",
  interactionFallbackUrl: process.env.DISCORD_INTERACTIONS_FALLBACK_URL || undefined,
  discordApiBaseUrl: process.env.DISCORD_API_BASE_URL || "https://discord.com/api",
  projectDir,
  workspacesFile: process.env.CODEX_WORKSPACES_FILE || undefined,
  allowedUsers: csv(process.env.DISCORD_ALLOWED_USER_IDS),
  allowedChannels: csv(process.env.DISCORD_ALLOWED_CHANNEL_IDS),
  requireMention: bool(process.env.DISCORD_REQUIRE_MENTION, true),
  progressEnabled: bool(process.env.DISCORD_PROGRESS_ENABLED, false),
  codexBin: process.env.CODEX_BIN || "codex",
  appServerUrl: process.env.CODEX_APP_SERVER_URL || undefined,
  appServerToken: process.env.CODEX_APP_SERVER_TOKEN || undefined,
  sharedThreadId: process.env.CODEX_SHARED_THREAD_ID || undefined,
  model: process.env.CODEX_MODEL || undefined,
  effort: process.env.CODEX_REASONING_EFFORT || undefined,
  sandbox: process.env.CODEX_SANDBOX || "danger-full-access",
  approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "never",
  stateDir: path.resolve(process.env.CODEX_DISCORD_STATE_DIR || ".state"),
};
