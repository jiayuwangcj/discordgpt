# discordgpt

Control persistent OpenAI Codex sessions from Discord. Direct messages and
allowlisted guild channels each retain their own Codex thread, serialize turns,
and can be opened from a terminal through the same local app-server.

This repository is intentionally independent from `wbot`: it contains no
trading, market-data, database, or notification-channel logic. It uses
`discord.js` for Discord and `codex app-server` for persistent agent threads.

See [README.zh.md](README.zh.md) for setup, security guidance, commands, multi-instance usage, and current limitations.

Quick start:

```bash
npm install
cp .env.example .env
# Fill DISCORD_BOT_TOKEN, CODEX_PROJECT_DIR, and DISCORD_ALLOWED_USER_IDS
npm run build
npm start
```

Defaults are intentionally conservative: `workspace-write`, no approval escalation, explicit Discord user allowlist, and mention-only behavior in guild channels.

See [MIGRATION.md](MIGRATION.md) for the remaining features being extracted
from wbot and [UPSTREAM.md](UPSTREAM.md) for the open-source evaluation and
attribution behind this implementation.

For a shared HPC/tmux view, set `CODEX_APP_SERVER_URL=ws://127.0.0.1:4500`, start with `scripts/start-shared-tmux.sh`, then attach the TUI to the Discord thread with `scripts/attach-thread.sh`. Both clients use the same Codex app-server and thread.
