# Changelog

## v0.3.0 — 2026-10-11

- Added bounded Chinese natural-language workspace management in server parent chats.
- Reusable creation/open/list tools; command and natural-language creation share one implementation.
- Persistent creator/parent-scoped topic index, clickable navigation, existing-topic reuse,
  ambiguity clarification and same-name creation protection.
- Main chats no longer execute arbitrary engineering prompts; native topics and DMs are unchanged.
- Archived-topic reopening, locked-topic failure and structured management logs.
- No additional MCP service, model inference or remote account permissions required.

Validation: 23 automated tests, type checking, zero dependency advisories and actual
installed Codex app-server handshake. Simulated standalone runtime covers natural
creation, existing-topic opening, listing and parent-chat execution refusal, alongside
independent engineering turns in two topics and a DM.

Live Discord deployment is still separate from simulated runtime acceptance;
the existing wbot bot is not switched by this release.

## v0.2.0 — 2026-10-11

- Added native Discord private topics bound to configured workspace aliases.
- Independent persistent Codex threads and cwd for each topic; retained legacy DMs.
- Added workspace listing, permission preflight, no-mention chat in bound topics,
  parent-channel allowlist inheritance, and immutable directory bindings.
- Fail closed on unknown topics and removed/moved workspace configuration.
- Added workspace/state/RPC tests and standalone simulated two-topic + DM acceptance.

Validation: 17 automated tests, type check, dependency audit and actual installed
Codex app-server handshake smoke. Native-topic acceptance uses local simulated
Discord Gateway/REST, including parent allowlists and mention rules; also verifies
topics do not inherit an explicitly shared DM thread.

Live Discord creation still requires dedicated bot deployment and server permissions;
this release does not switch the existing wbot bot.

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
