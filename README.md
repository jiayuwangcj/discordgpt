# discordgpt

Control persistent OpenAI Codex sessions from Discord. Direct messages and
workspace topics each retain their own Codex thread, serialize turns,
and can be opened from a terminal through the same local app-server.

This repository is intentionally independent from `wbot`: it contains no
trading, market-data, database, or notification-channel logic. It uses
`discord.js` for Discord and `codex app-server` for persistent agent threads.

See [README.zh.md](README.zh.md) for setup, security guidance, commands, multi-instance usage, and current limitations.

Release: **v0.4.7**. Node.js 20+ and an authenticated Codex CLI are required.

Quick start:

```bash
npm ci
cp .env.example .env
# Fill DISCORD_BOT_TOKEN, CODEX_PROJECT_DIR, and DISCORD_ALLOWED_USER_IDS
chmod 600 .env
npm run build
npm start
```

New and resumed/bound Codex threads default to YOLO: `danger-full-access` and
`approvalPolicy=never`. Explicit instance settings can select `workspace-write`
or `read-only`. Discord user allowlists and guild mention settings still apply.

Configure `CODEX_WORKSPACES_FILE` as a host-side JSON object of aliases to absolute
existing directories. Added aliases are hot-loaded without restarting or waiting
for other sessions. Existing private topics can be provisioned with
`scripts/bind-workspace-topic.mjs`; see [OPERATIONS.md](OPERATIONS.md#hot-loading-workspace-topics).
In a server text channel, send
`@bot !codex topic <workspace-alias> [topic-name]`. The bot creates a private
Discord thread, binds its workspace, and adds the requester. Talk directly in
that thread without mentions. Topics and DMs have independent contexts by default;
explicitly binding the same existing Codex thread shares its context and queue.
Use `!codex workspaces` to list configured aliases; directory changes require a
new topic rather than silently rebinding an existing conversation. Setup and
required permissions are documented in [README.zh.md](README.zh.md#工作区话题).

Ordinary messages in server text channels, DMs and bound workspace topics go
directly to Codex, including development and management tasks. The rule-based
workspace assistant has been removed. Explicit `!codex` commands remain available;
creating a Discord topic requires a server text channel. DMs bypass the guild
channel allowlist while still enforcing the user allowlist and configured sandbox.

Use `/sessions [query] [cursor]` to browse existing Codex conversations for the
current workspace. `/bind thread:<selection or full ID>` autocompletes conversation
titles and resumes the selected thread without starting a new one. DMs also support
`!codex sessions [query] [--cursor <cursor>]` and `!codex bind <thread ID>`.
Guild slash replies are ephemeral; text commands do not publish session titles.
Binding requires an idle window and target, preserves the workspace and sandbox,
and persists across restarts. Windows bound to the same thread share FIFO/model
settings. `/reset` detaches only the current window and retains the native thread.

See [MIGRATION.md](MIGRATION.md) for the remaining features being extracted
from wbot and [UPSTREAM.md](UPSTREAM.md) for the open-source evaluation and
attribution behind this implementation.

For a shared HPC/tmux view, set `CODEX_APP_SERVER_URL=ws://127.0.0.1:4500`, start with `scripts/start-shared-tmux.sh`, then attach the TUI to the Discord thread with `scripts/attach-thread.sh`. Both clients use the same Codex app-server and thread.

Send tasks in a DM, workspace topic, or authorized server text channel. Mention
the bot in server text channels unless mentions are disabled. Use `!codex status`, `!codex stop`, `!codex reset`, and
`!codex history 20 summarize decisions`. Status and stop execute immediately
even while a model task is running. Replies are delivered on completion;
`DISCORD_PROGRESS_ENABLED=true` enables commentary before tool calls.
Each task has a card in its own window showing queued, working, paused and
terminal states. Discord typing is renewed while work runs, even with commentary
disabled. Status delivery failures do not cancel inference.
Cards show that request's model/effort and shared quota. Mobile thread subtitles
are Discord's built-in parent channel names, independently of bot Presence.
The bridge does not rename channels to display status. Use task cards and
`/status` or `/usage` for window/account details.

```bash
npm run verify  # type check, automated tests, dependency audit
npm run smoke   # actual installed app-server startup + state persistence
```

`smoke` requires Codex on PATH but no Discord token and starts no model turn.
Transport tests use a local mock server. A successful smoke test does not mean
Discord Gateway delivery has been tested with a real bot.

See [OPERATIONS.md](OPERATIONS.md) for independent service deployment,
failure recovery, logs and the live DM acceptance steps, and
[CHANGELOG.md](CHANGELOG.md) for release validation.

Dynamic model/effort settings and task controls are available as Discord slash
commands and `!codex` commands. Use `/model`, `/models`, `/status`, `/usage`,
`/ps`, `/stop`, `/cancel`, `/steer` and `/resume`. Settings belong to the current
conversation; quota belongs to the account. Lifecycle notices go to authorized
DMs, while task/queue/heartbeat notices stay in their original window.

See [FEATURE_PARITY.md](FEATURE_PARITY.md) for the old-service comparison and
acceptance status. Existing HTTP interaction endpoints require the signed ingress
and reverse proxy described in [OPERATIONS.md](OPERATIONS.md); clearing the old
endpoint would break unrelated business buttons. `npm run test:offline` explicitly
skips socket transport tests and is not the complete release gate.
