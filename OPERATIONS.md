# Independent operation

## Installation

Install Node.js 20+ and authenticate the Codex CLI using its normal login.
Clone this repository, run `npm ci`, and run `npm run build`. Copy
`.env.example` to `.env` and set its mode to `0600`.

Required settings:

| Setting | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Dedicated Discord bot token |
| `DISCORD_ALLOWED_USER_IDS` | Comma-separated authorized user IDs; empty fails startup |
| `CODEX_PROJECT_DIR` | Workspace for commands and file edits |

Optional settings:

| Setting | Default / behavior |
| --- | --- |
| `DISCORD_ALLOWED_CHANNEL_IDS` | Empty allows channels reachable by the bot, but still requires an authorized user |
| `DISCORD_REQUIRE_MENTION` | `true` in guilds; DMs need no mention |
| `DISCORD_PROGRESS_ENABLED` | `false`; send final answer once the task ends |
| `CODEX_BIN` | `codex`; use an absolute path under a service manager |
| `CODEX_MODEL` | Codex's configured default |
| `CODEX_SANDBOX` | `workspace-write` |
| `CODEX_APPROVAL_POLICY` | `never` |
| `CODEX_DISCORD_STATE_DIR` | `.state` relative to service working directory |
| `CODEX_APP_SERVER_URL` | Empty spawns owned stdio app-server; loopback `ws://` or authenticated `wss://` connects to an external server |
| `CODEX_APP_SERVER_TOKEN` | Bearer token for authenticated remote server |
| `CODEX_SHARED_THREAD_ID` | Optional explicit shared thread; all channels using it share one queue |
| `CODEX_DISCORD_ENV_FILE` | Explicit config file; otherwise `.env` in current working directory |
| `DISCORD_API_BASE_URL` | Default Discord API; local test harness overrides this for simulated Gateway/REST acceptance |

Enable Message Content Intent in the Discord Developer Portal. Grant channel
view, send, read history, and attach-file permissions. Use one bridge per token
and state directory. Run `npm start` from this repository or use the service below.

## Linux service

Adapt the absolute paths and copy this template to
`~/.config/systemd/user/discordgpt.service`:

```ini
[Unit]
Description=Discord Codex bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/discordgpt
Environment=CODEX_DISCORD_ENV_FILE=/absolute/path/to/discordgpt.env
Environment=CODEX_BIN=/absolute/path/to/codex
ExecStart=/absolute/path/to/node /absolute/path/to/discordgpt/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
UMask=0077

[Install]
WantedBy=default.target
```

Start with `systemctl --user daemon-reload` and
`systemctl --user enable --now discordgpt`. Inspect logs using
`journalctl --user -u discordgpt -f`. Configuration is read directly by dotenv;
there is no requirement to source credentials as shell code.

## Recovery

Each channel maps to a thread in `state.json`; keep the state directory when
upgrading. Resume errors retain that binding. Use `!codex reset` only when
intentionally starting a new conversation. Reset is blocked during queued
work and is disabled for explicit shared threads.

Transport disconnects make the service exit with failure so the supervisor can
restart it. RPC requests have a 20-second admission timeout; model execution
has no artificial turn deadline. SIGINT/SIGTERM close the Discord client and
app-server connection. In external-server mode, closing the bridge leaves the
external server running.

Queues and in-flight completion delivery are not yet durable. A restart can
lose pending tasks/replies; inspect the native thread before resending a task
with side effects. Stopping a turn does not remove queued tasks.

## Verification and live acceptance

`npm run verify` checks types, the isolated protocol/queue/state/formatting
tests, and npm dependency advisories. `npm run smoke` starts a separate actual
Codex app-server, validates the initialization handshake, restores concurrently
written state, and exits. It does not log in to Discord or issue a model turn.

Before moving an existing bot token from wbot:

1. Preserve the original service and thread bindings for rollback.
2. Use a separate test bot or stop the old bridge before starting discordgpt
   with that token. Do not run two Gateway consumers for a single bot.
3. Send a DM, then a follow-up that requires prior context. Verify one thread.
4. Start a long task and run `!codex status` and `!codex stop` while it runs.
5. Send two tasks rapidly; confirm FIFO results and complete links in replies.
6. Restart the service and confirm the next DM resumes the saved thread.
7. Where shared app-server mode is used, attach the terminal to the reported
   thread and check continuity before retiring wbot's assistant entry point.

The standalone v0.1.1 release has not yet replaced the live wbot bridge.
