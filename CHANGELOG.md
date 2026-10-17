# Changelog

## v0.4.6 — remove channel-name status — 2026-10-15

- Withdraw quota-as-channel-name presentation and restore the existing parent name. Remove its configuration, background writer, updater utility and deploy opt-in; upgrades remove the retired instance setting.
- Keep model/effort, quota and work status in each task card and `/status`/`/usage`. Discord's built-in parent subtitle is not a bot-controlled status widget.
- Preserve the two existing threads and their chat histories; no parent/thread deletion or conversation rebinding is performed as part of removing this presentation feature.
- Validation: all 55 remaining tests pass without skips, type/build and dependency audit pass. The actual parent name was restored and GET-verified; the retired setting was removed from the instance environment before guarded rollout.

## v0.4.5 — mobile topic header quota — 2026-10-15

This channel-name experiment was withdrawn in v0.4.6 after user feedback. Per-task model details remain.

- The mobile thread-header subtitle is its parent channel name, not bot Presence. Add explicit opt-in quota parent names (for example `限额-5h49％-w85％`) so this actual UI field shows shared account quota.
- Persist the original name, last name and rename cooldown before modifying Discord. Update at most once per ten minutes, coalesce concurrent refreshes, skip stale quota, and preserve unexpected operator name changes. Only configured, managed text parents can be targeted; no permission grants or channel recreation.
- Show each request's own model/effort and shared quota in its task card. Pin running-task model metadata when its native turn starts; future setting changes update pending cards without relabelling a running task.
- Add `DISCORD_QUOTA_HEADER_CHANNEL_IDS`, guarded deploy option `--quota-header-channel ID`, and a one-time header update utility with a Discord GET verification. Bot Presence remains separate from the mobile channel header.
- Validation: all 59 tests pass (no skips), build/types and dependency audit pass. The dedicated parent's first rename was GET-verified against Discord; ongoing maintenance and per-topic card details deploy through the normal guarded drain/health procedure.

## v0.4.4 — presence recovery — 2026-10-15

- Replace the bare `Codex` login fallback with quota-loading text. Restore complete task/quota/active-model Presence on Gateway READY/RESUMED and every client-ready event, including reconnects after the initial startup.
- Republish every 30 seconds independently of the five-minute account/catalog polling. Coalesce task, quota, reconnect and heartbeat updates through one five-second throttle using the latest state, in line with Discord's activity update limit.
- Include the last locally submitted Presence label/status/time in `health.json` to diagnose stale display; this records publication to the Gateway transport, not visual confirmation from a Discord client.
- Validation: all 55 tests pass (no skips), including a runtime reconnect event; types/build and dependency audit pass. Actual app-server smoke is repeated by the guarded publisher before draining current work.

## v0.4.3 — model acknowledgement recovery — 2026-10-12

- Release the control-state queue before delivering confirmations, so a delayed Discord reply cannot block STOP or later controls in the same topic.
- Retry transient TLS/socket failures only for idempotent interaction-reply PATCHes, up to three attempts. Never repeat the model mutation or a message-creation POST.
- Preserve successfully saved settings if confirmation delivery fails, audit the failed acknowledgement, and avoid falsely reporting that the state change was rolled back. Regression coverage includes STOP while model confirmation stalls and recovery after the observed TLS error.
- Validation: all 51 tests pass with no skips; type/build and dependency audit pass. The guarded publisher repeats verification and actual app-server smoke before draining current work.

## v0.4.2 — compact quota label — 2026-10-12

- Omit the generic `codex:` bucket label from compact status-bar quota, displaying `限额：5h-79% w-92%` directly. Keep distinct additional quota buckets identifiable and retain full details in `/usage`.

## v0.4.1 — topic task status — 2026-10-12

- Remove hostname and project name from global Presence, including startup, to leave room for task counts, models and quota. Retain Slurm time when available.

- Renew Discord typing every seven seconds throughout a running request, including Codex admission and shared-thread waits; stop renewal on all exit paths. Typing REST failures no longer fail model work.
- Show a task card in the request's own window immediately, update queued/running/quota-paused states, and remove buttons when finished, stopped or failed. Serialize card edits and handle delayed/failed Discord delivery without reverting terminal status or resurrecting controls.
- Validation: all 47 tests pass, including socket/runtime integration and new typing/card lifecycle cases; actual installed app-server smoke passes; dependency audit reports zero vulnerabilities. Deployment uses the guarded drain/health/rollback procedure and waits for current work to end.

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
