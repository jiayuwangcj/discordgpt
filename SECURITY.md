# Security

Discord-to-Codex access is remote code execution by another name.

- Keep `DISCORD_ALLOWED_USER_IDS` explicit and narrow.
- Keep the app-server on loopback or a Unix socket.
- Use `workspace-write` and `approvalPolicy=never` by default.
- Never commit `.env`, bot tokens, thread IDs, downloaded attachments, or logs.
- Run one bridge process per bot token and state directory.
- Prefer a dedicated OS account or isolated host for `danger-full-access`.

Report vulnerabilities privately to the repository owner rather than opening a
public issue containing credentials or exploit details.
