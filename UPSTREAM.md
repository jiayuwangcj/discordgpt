# Upstream and prior art

discordgpt starts from the Discord package of
[`Lihan-Zhong/codex-chat-bridge`](https://github.com/Lihan-Zhong/codex-chat-bridge),
used under the MIT License. Its original history is retained in this repository.

The design review also considered:

- [`imprisonedmind/codex-discord-bridge`](https://github.com/imprisonedmind/codex-discord-bridge): the closest feature match, including project-channel discovery, approvals, recovery, attachments, and an operator CLI. It had no declared license when reviewed, so no code was copied.
- [`shadohead/codex-bridge`](https://github.com/shadohead/codex-bridge): useful reference for a shared app-server daemon, level-triggered recovery, per-thread locking, and reconnect-safe approvals.
- [`hitsmaxft/codex-bridge`](https://github.com/hitsmaxft/codex-bridge): useful reference for app-server supervision, writer ownership, read-only fallback, and mobile remote access.
- [`comeran/discord-codex-bridge`](https://github.com/comeran/discord-codex-bridge): a smaller `codex exec` based bridge with channel/project bindings and serial execution.

The wbot implementation remains an internal migration source for behavior that
was developed independently: delayed-result delivery, dynamic model catalog,
usage display, writer retry, paragraph-safe chunking, and append-only audit
history. No trading-specific code belongs in this repository.
