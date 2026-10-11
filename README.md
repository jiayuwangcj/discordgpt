# discordgpt

Control persistent OpenAI Codex sessions from Discord. Direct messages and
workspace topics each retain their own Codex thread, serialize turns,
and can be opened from a terminal through the same local app-server.

This repository is intentionally independent from `wbot`: it contains no
trading, market-data, database, or notification-channel logic. It uses
`discord.js` for Discord and `codex app-server` for persistent agent threads.

See [README.zh.md](README.zh.md) for setup, security guidance, commands, multi-instance usage, and current limitations.

Release: **v0.3.0**. Node.js 20+ and an authenticated Codex CLI are required.

Quick start:

```bash
npm ci
cp .env.example .env
# Fill DISCORD_BOT_TOKEN, CODEX_PROJECT_DIR, and DISCORD_ALLOWED_USER_IDS
chmod 600 .env
npm run build
npm start
```

Defaults are intentionally conservative: `workspace-write`, no approval escalation, explicit Discord user allowlist, and mention-only behavior in guild channels.

Configure `CODEX_WORKSPACES_FILE` as a host-side JSON object of aliases to absolute
existing directories. In a server text channel, send
`@bot !codex topic <workspace-alias> [topic-name]`. The bot creates a private
Discord thread, binds its workspace, and adds the requester. Talk directly in
that thread without mentions. Every topic has independent Codex context, even
when two topics use the same directory. DMs keep their original separate context.
Use `!codex workspaces` to list configured aliases; directory changes require a
new topic rather than silently rebinding an existing conversation. Setup and
required permissions are documented in [README.zh.md](README.zh.md#工作区话题).

The server parent chat is now a workspace assistant, not an engineering agent.
Say `@bot 给 wbot 开一个话题，叫交易开发`, `@bot 打开 wbot`, or
`@bot 列出我的工作区和话题`. It invokes bounded, reusable management tools;
it is not an MCP server or an unrestricted LLM interpreter. Missing workspace
names prompt a clarification; reply with an alias within five minutes. Existing
entries are reused and ambiguous choices return links rather than guessing.
Engineering work remains in native topics and DMs. The explicit `!codex`
commands remain available; natural-language deletion/reset is not supported.

See [MIGRATION.md](MIGRATION.md) for the remaining features being extracted
from wbot and [UPSTREAM.md](UPSTREAM.md) for the open-source evaluation and
attribution behind this implementation.

For a shared HPC/tmux view, set `CODEX_APP_SERVER_URL=ws://127.0.0.1:4500`, start with `scripts/start-shared-tmux.sh`, then attach the TUI to the Discord thread with `scripts/attach-thread.sh`. Both clients use the same Codex app-server and thread.

Send engineering tasks in a DM or workspace topic; mention the bot in an authorized
parent channel for management. Use `!codex status`, `!codex stop`, `!codex reset`, and
`!codex history 20 summarize decisions`. Status and stop execute immediately
even while a model task is running. Replies are delivered on completion;
`DISCORD_PROGRESS_ENABLED=true` enables commentary before tool calls.

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
