# Changelog

## v0.1.1 — 2026-10-11

First independently verified discordgpt release, following the initial v0.1.0
repository bootstrap.

- Fixed STOP/status commands being trapped behind long model tasks.
- Serialized shared-thread work across channels.
- Fixed concurrent state writes racing over the same temporary file.
- Retained thread bindings on resume errors instead of silently starting fresh.
- Added completion-only replies and paragraph/link/Unicode-safe splitting.
- Added RPC admission deadlines, missing-binary failure handling, and shutdown.
- Added explicit configuration validation, operating guide and Node 20/22/24 CI.

Validation: type check; 13 automated tests (including a standalone bot process
receiving a DM through simulated Discord Gateway/REST and returning a Codex
answer); zero npm advisories; actual installed
Codex app-server startup/handshake and state persistence smoke test. Real Discord
DM delivery and wbot cutover remain separate deployment acceptance steps.
