# Chat feature parity: wbot → discordgpt v0.4.0

This inventory compares the previous Discord assistant implementation and its
2026-08/09 task records with this standalone bridge. Trading notifications,
orders, market data, databases and their business buttons remain outside this
repository. Runtime imports do not depend on wbot.

| Previous behavior | v0.4.0 behavior / placement | Automated evidence |
| --- | --- | --- |
| Authorized DMs and persistent thread | DMs bypass the guild channel list; user authorization still applies | Offline bot wiring, state reload, runtime DM test |
| Native workspace topics | Independent directory and Codex context; parent allowlist inherited | Topics/state tests, runtime topic test |
| Topic activation (v0.4.7 fix) | Hot-load added host aliases and existing private-topic bindings while other turns run; explicit unbound-topic feedback, no global idle/restart gate | Concurrent live-state reload, malformed/conflicting config, persistence failure, provisioning utility and busy-window routing regressions |
| Main management channel | Rule parser removed; normal tasks/history go to Codex | Offline bot wiring, runtime guild test |
| Starting, first READY, normal/abnormal exit notifications | Authorized-user DMs through REST; reconnect does not repeat READY | Lifecycle notifier tests |
| `/model` + effort | Live paginated catalog; autocomplete and exact/unique aliases; model-specific validation | Catalog, protocol and offline bot tests |
| Persist last model/effort | Per effective Codex thread queue key; shared-thread windows explicitly share settings | State isolation/reset/restart tests |
| Active turn unaffected by setting command | Stored selection applies on the next turn; active settings reported separately | Offline bot model and queue tests |
| Model confirmation delivery (v0.4.3 fix) | Network acknowledgements run outside the control-state lock; transient TLS failures retry only the original reply PATCH; exhausted delivery does not falsely roll back or retry a saved setting | Delivery isolation/retry tests and offline STOP-during-model-confirmation regression |
| `/status` | Window directory, permissions, connection, thread, model, tasks, account quota, instruction files and available CLI/provider metadata | Offline status, usage and protocol tests |
| `/ps`, `/stop` | Task IDs/phases; active turn interrupted, otherwise oldest owned pending request cancelled | Scheduler and offline bot tests |
| Queue card stop/steer buttons | Original owner, channel and exact card required; remove controls on completion | Ownership tests; live click still required |
| Active steer | Native `turn/steer`, same turn; `/steer` adds specific directions | Protocol and offline bot tests |
| FIFO, queue capacity and cancellation | Per-thread bounded FIFO; different windows run independently | Scheduler tests |
| Long-task late completion | No model execution deadline; final response delivered after completion | Protocol/runtime tests |
| Fifteen-minute heartbeat | Sent only while a request runs or waits for a shared writer; stopped at completion/failure | Heartbeat tests |
| In-window working status (v0.4.1 fix) | Renew typing every seven seconds and maintain one card per request in the originating topic/DM; serial phase/terminal edits, remove controls on finish, isolate REST failures | Typing lifetime/slow REST tests, task-card lifecycle/late delivery tests and offline runtime |
| Account remaining usage | Backend buckets, remaining percent, reset time; startup + five-minute refresh; stale values labelled | Usage and offline status tests |
| Quota pause/resume | Explicit quota failures pause the head request; backend permission allows automatic continuation; `/resume` is an explicit manual retry | Quota, scheduler and offline bot tests |
| Recovered-usage notice | Sent in the affected task window before continuing; no unrelated-window broadcast | Scheduler/offline bot tests |
| Online/model/usage Presence | Global activity shows Slurm time when available, aggregate task counts, quota and active models; hostname/project removed to conserve space | Presence helpers; live presence still required |
| Presence recovery (v0.4.4 fix) | No bare Codex fallback; republish after client/shard ready and resume plus 30-second heartbeat, under a shared throttle; last submitted label in health | Startup/reconnect/coalescing/failure tests and runtime Gateway-event regression |
| Mobile topic header (v0.4.6) | Native parent name retained; quota-as-channel-name experiment removed. Model/effort, quota and task state remain in each request's card and status commands | Task-card details and runtime model isolation; no channel-renaming runtime |
| Reconnect message replay protection | Bounded 2,048-entry, one-hour replay cache; signed HTTP response replay cache | Offline bot duplicate-message and HTTP duplicate-interaction tests |
| Message history on demand | Explicit `!codex history`, bounded to 100 messages, current window only | History tests |
| Images and attachments | Discord CDN images use localImage; other attachments keep URLs | Attachment tests |
| Reply paragraphs, links and Unicode | 1,900 UTF-16-unit splitting; completion-only by default, opt-in progress | Format/progress tests |
| Audit/history diagnostics | Private, serialized, rotating JSONL task/control metadata; no prompt bodies or credentials | Audit tests |
| Shared terminal session | Same app-server/thread; wait for observed active external writer rather than deliberately steering it | Protocol tests; real shared-terminal acceptance still required |
| Select an existing conversation (new) | `/sessions` workspace-filtered, paginated discovery; `/bind` title autocomplete/full ID; native resume without thread creation; persistent binding and shared FIFO/settings | Encoded session protocol, state/rollback and offline bot binding/search/cross-window tests |
| Default permissions (updated) | New and bound threads use YOLO `danger-full-access` + `never`; explicit instance configuration still wins; host upgrade `--yolo` switches existing restricted settings | Config defaults/override and encoded start/resume/turn permission tests |
| `/compact`, `/side` | Prior implementation was explicitly unsupported. Preserve that response; `/topic` supplies separate conversations | Command-contract test |
| HTTP interactions delivery | Verified Ed25519 ingress, initial acknowledgement, original endpoint passthrough for unrelated business actions; Gateway mode still available | Signed ingress tests; public reverse proxy/Discord acceptance still required |
| Safe release handoff | Snapshot candidate, integrity check, complete test/smoke gate, drain/legacy idle gate, state/model import, health gate and rollback | Upgrade script syntax; guarded systemd rollout and health/endpoint gates passed |

Model changes never change the configured sandbox/approval policy. Catalog
errors preserve the previous selection. Backend percentages do not imply
permission to resume: Codex 0.162.1 exposes `ordinaryUsageAllowed`, and unknown
or stale permission prevents automatic retries. `/resume` asks explicitly to
continue; an explicit backend denial still prevents it.

Compatibility notes:

- Queue and paused requests remain in memory, as in the old assistant. A crash
  can lose undelivered work; never automatically replay unknown side effects.
  The upgrade tool waits for outstanding work, including quota pauses, to clear.
- An active external writer can start between a metadata read and turn admission;
  separate threads/worktrees are required for strict concurrent editing isolation.
- SIGKILL, host power loss, or total network loss cannot deliver a shutdown notice.
- Code-fence continuation for oversized replies remains outside the old baseline.
- Upgrades import model/effort only when the saved DM thread ID matches the
  legacy handoff snapshot. No arbitrary conversation is rebound.

## Validation and deployment status — 2026-10-12

`npm run verify` passed all 42 tests with zero skips, type checks and zero npm
advisories. `npm run smoke` initialized the actual installed Codex app-server.
The guarded upgrade deployed v0.4.0 and switched the existing restricted instance
to `danger-full-access` / `never`. Fresh Gateway, all 17 registered commands,
model catalog and usage health passed; the service is accepting work with no
drain marker. All three original channel/thread IDs and workspace/topic bindings
were retained. Native `thread/resume` verified each original cwd and the actual
backend permission response without starting a model turn.

A dedicated HAProxy path reaches the loopback-only signed ingress through a
supervised SSH Unix-socket tunnel. The old business path remains available.
Both public paths reject unsigned requests with HTTP 401; Discord validated
the new endpoint using its real signed PING. Forwarded business requests retain
their signature, body and User-Agent for the existing proxy filter.

Manual `/status`, model changes followed by a task, queue-button clicks, live
presence, shared-terminal continuity and business-button clicks have not been
claimed as tested. Automated protocol/runtime coverage and real deployment
checks do not replace those user interaction checks.

Protocol reference: [official OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server). Local Codex 0.162.1 generated schemas were also checked for model/effort, turn errors and backend quota permission.
