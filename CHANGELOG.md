# Changelog

## v0.4.0 — 2026-10-12

- 2026-10-12: Default new and bound/resumed Codex conversations to YOLO (`danger-full-access`, `never`), including bootstrap/direct and fresh handoff settings. Preserve explicit overrides; `upgrade-service.mjs deploy --yolo` switches existing restricted instance configuration with normal rollback.

- Remove the rule-only management-channel interceptor; guild tasks now reach Codex. Authorized DMs bypass the guild channel allowlist.
- Restore live catalog model/effort controls, per-conversation persisted settings, account remaining-usage/status, lifecycle DMs and long-task heartbeat.
- Restore slash controls, task cards, FIFO cancellation/steering and quota pause/continuation; replay protection, aggregate presence and rotating private audit metadata.
- Add signed HTTP interaction ingress with passthrough for existing business actions, and a guarded upgrade/rollback utility that preserves thread bindings and model/effort.
- Add `/sessions` workspace-scoped existing-conversation discovery and `/bind` title autocomplete/full thread ID. Resume original context without creating a thread, persist bindings, share FIFO/model settings for the same thread, and detach only the current window on reset. Keep sandbox restrictions and private session discovery.
- Preserve the Discord User-Agent when forwarding signed business interactions through an existing proxy filter.
- Add FEATURE_PARITY.md and protocol/runtime coverage. All 42 tests (no skips), type checks, dependency audit and actual app-server smoke passed.
- Deployed through the guarded host upgrader: fresh Gateway/command/catalog/usage health, public ingress signature rejection, Discord signed PING acceptance, and native resume of all three original contexts with YOLO permissions passed. Manual slash/model/queue-button and business-button clicks remain separate acceptance.

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
