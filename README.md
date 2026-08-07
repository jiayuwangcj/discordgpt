# codex-discord-multibot

One dedicated Discord bot per local Codex project, with persistent per-channel threads and a locked-down Codex sandbox.

This is a Codex-native adaptation of `claude-code-discord-multibot`. It uses `discord.js` for Discord and `codex app-server` for persistent agent threads; it does not depend on Claude or the Claude Discord plugin.

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

For a shared HPC/tmux view, set `CODEX_APP_SERVER_URL=ws://127.0.0.1:4500`, start with `scripts/start-shared-tmux.sh`, then attach the TUI to the Discord thread with `scripts/attach-thread.sh`. Both clients use the same Codex app-server and thread.
