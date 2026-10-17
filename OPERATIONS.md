# Independent operation

## Installation

Install Node.js 20+ and authenticate the Codex CLI using its normal login.
Clone this repository, run `npm ci`, and run `npm run build`. Copy
`.env.example` to `.env` and set its mode to `0600`.

Required settings:

| Setting | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Dedicated Discord bot token |
| `DISCORD_ALLOWED_USER_IDS` | Comma-separated authorized user IDs; empty fails startup |
| `CODEX_PROJECT_DIR` | Workspace for commands and file edits |

Optional settings:

| Setting | Default / behavior |
| --- | --- |
| `DISCORD_ALLOWED_CHANNEL_IDS` | Empty allows channels reachable by the bot, but still requires an authorized user |
| `DISCORD_REQUIRE_MENTION` | `true` in guilds; DMs need no mention |
| `DISCORD_PROGRESS_ENABLED` | `false`; send final answer once the task ends |
| `CODEX_BIN` | `codex`; use an absolute path under a service manager |
| `CODEX_MODEL` | Codex's configured default |
| `CODEX_WORKSPACES_FILE` | Optional host-side JSON object of aliases to existing absolute directories; `default` remains `CODEX_PROJECT_DIR` |
| `CODEX_SANDBOX` | `danger-full-access` (YOLO); explicit `workspace-write` or `read-only` overrides this |
| `CODEX_APPROVAL_POLICY` | `never` |
| `CODEX_DISCORD_STATE_DIR` | `.state` relative to service working directory |
| `CODEX_APP_SERVER_URL` | Empty spawns owned stdio app-server; loopback `ws://` or authenticated `wss://` connects to an external server |
| `CODEX_APP_SERVER_TOKEN` | Bearer token for authenticated remote server |
| `CODEX_SHARED_THREAD_ID` | Optional default shared thread for channels without a workspace; an explicit `/bind` takes precedence |
| `CODEX_DISCORD_ENV_FILE` | Explicit config file; otherwise `.env` in current working directory |
| `DISCORD_API_BASE_URL` | Default Discord API; local test harness overrides this for simulated Gateway/REST acceptance |

Enable Message Content Intent in the Discord Developer Portal. Grant channel
view, send, read history, and attach-file permissions. Use one bridge per token
and state directory. Run `npm start` from this repository or use the service below.

New threads and all resume/bind paths use the same instance permissions. YOLO
means `danger-full-access` with `never`; it removes Codex sandbox/approval limits
within the service user's host permissions. Existing explicit instance settings
take precedence over the defaults. To switch an existing restricted deployment,
use `deploy <candidate> --yolo` in the upgrade tool on the host. This changes only
the deployed instance's environment during the guarded release, with rollback;
it does not change the permissions of the development session running the tool.

## Linux service

Adapt the absolute paths and copy this template to
`~/.config/systemd/user/discordgpt.service`:

```ini
[Unit]
Description=Discord Codex bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/discordgpt
Environment=CODEX_DISCORD_ENV_FILE=/absolute/path/to/discordgpt.env
Environment=CODEX_BIN=/absolute/path/to/codex
ExecStart=/absolute/path/to/node /absolute/path/to/discordgpt/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
UMask=0077

[Install]
WantedBy=default.target
```

Start with `systemctl --user daemon-reload` and
`systemctl --user enable --now discordgpt`. Inspect logs using
`journalctl --user -u discordgpt -f`. Configuration is read directly by dotenv;
there is no requirement to source credentials as shell code.

## Recovery

The mobile thread subtitle is Discord's parent channel name, not a bot status
widget. The v0.4.5 channel-renaming experiment was removed in v0.4.6; upgrading
removes its retired instance setting. Keep task state/model/quota in cards and
`/status`/`/usage`. Original-name records are retained privately for rollback,
but the service no longer reads or writes `quota-headers.json`. Removing status
presentation does not delete parent channels or their dependent threads.

If `/model` remains on “thinking”, inspect `model.selected` and the window's
persisted settings before retrying the change. Selection is saved before its
Discord confirmation; a network/TLS reply failure does not mean saving failed.
Since v0.4.3, confirmation delivery occurs outside the control-state queue,
transient interaction PATCH failures are retried, and exhausted delivery failures
are audited as `control.reply.failed`. `/status` reports the next-turn selection.
Existing running turns keep their original model until they end.

Workspace topics use Discord private threads, created from a guild text channel
with `!codex topic <alias> [name]`. Grant Create Private Threads, Send Messages in
Threads and Manage Threads in addition to the base permissions. The authorized
requester is added automatically; moderators with Manage Threads can also view
private threads. Bound topics inherit the parent channel allowlist, but still
check the user allowlist. DMs bypass the guild channel allowlist and still require an allowlisted user. Private topic messages do not require a mention.

Keep `state.json`: it contains immutable topic/workspace path bindings as well as
Codex thread IDs. Renaming a topic never changes cwd. If workspace configuration
is removed or moved, execution fails closed. Restore the old configuration or
create a new topic. Reset clears only the Codex context, not its workspace.
Existing DM state needs no migration. Context isolation does not isolate files:
use separate worktrees for concurrent edits in the same repository.

If creating a topic or adding its requester fails, inspect host logs and the
server's private-thread list before retrying; an already-created thread may remain.
This version does not automatically adopt manually-created threads.

Parent text channels, DMs and bound workspace topics send ordinary prompts and
explicit history requests to Codex. The rule-based management assistant has been
removed. Use `!codex topic <alias> [name]` in a guild text channel to create a
workspace topic; `!codex workspaces` also works in DMs. Mentions are still required
in the parent unless `DISCORD_REQUIRE_MENTION=false`. User allowlists and the
configured sandbox continue to apply to all model tasks.

Each channel maps to a thread in `state.json`; keep the state directory when
upgrading. Resume errors retain that binding. Use `!codex reset` only when
intentionally starting a new conversation. Reset is blocked during queued
work and is disabled for an implicit `CODEX_SHARED_THREAD_ID` binding.

Use `/sessions [query] [cursor]` and `/bind thread:<selection or ID>` to restore
an existing native conversation instead of starting a fresh thread. Discovery
uses `thread/list` for the current cwd, sorted by update time, without archived
or ephemeral sessions. Slash results are private. DMs support text equivalents;
guild text commands do not expose session titles. No native `thread/start` or
model turn is sent while listing or binding. `thread/read` validates the full ID,
cwd and idle/notLoaded status before resume; configured sandbox and approvals
remain in effect. Different projects must use their respective workspace topics.
Local running/queued/paused work blocks rebinding. A short admission gate prevents
tasks from entering stale queue keys during the switch. Native external writers
can still race a metadata check; coordinate shared terminal work as described below.

Explicit attachments persist in `state.json`. Every window referencing an
explicitly linked thread shares the thread queue and model settings, including
the original window if the thread was created by this bridge. Reset detaches
only one window, retains its workspace/model settings, and never deletes the
native conversation or detaches other windows. A configured default shared
thread is used again after an explicit attachment is reset.

Live acceptance: find a known previous discussion with `/sessions`, select it
through `/bind` autocomplete, ask about its earlier decisions and confirm no new
thread ID. Restart and confirm the same binding. Bind two windows to that thread
and verify serialization, ownership of `/stop`, and reset of only one window.

Transport disconnects make the service exit with failure so the supervisor can
restart it. RPC requests have a 20-second admission timeout; model execution
has no artificial turn deadline. SIGINT/SIGTERM close the Discord client and
app-server connection. In external-server mode, closing the bridge leaves the
external server running.

Queues and in-flight completion delivery are not yet durable. A restart can
lose pending tasks/replies; inspect the native thread before resending a task
with side effects. Stopping a turn does not remove queued tasks.

## Verification and live acceptance

`npm run verify` checks types, the isolated protocol/queue/state/formatting
tests, and npm dependency advisories. `npm run smoke` starts a separate actual
Codex app-server, validates the initialization handshake, restores concurrently
written state, and exits. It does not log in to Discord or issue a model turn.

Before moving an existing bot token from wbot:

1. Preserve the original service and thread bindings for rollback.
2. Use a separate test bot or stop the old bridge before starting discordgpt
   with that token. Do not run two Gateway consumers for a single bot.
3. Send a DM, then a follow-up that requires prior context. Verify one thread.
4. Start a long task and run `!codex status` and `!codex stop` while it runs.
5. Send two tasks rapidly; confirm FIFO results and complete links in replies.
6. Restart the service and confirm the next DM resumes the saved thread.
7. Where shared app-server mode is used, attach the terminal to the reported
   thread and check continuity before retiring wbot's assistant entry point.
8. Configure two workspace aliases and create private topics from the authorized
   parent channel. Confirm each topic reports its own directory and Codex thread,
   answers without mentions, and retains its binding after a service restart.
9. Confirm a DM still resumes its original context and does not know the topic
   conversation. Creating two topics for one workspace must also yield two threads.

The original handoff completed on 2026-10-11; v0.4.0 was deployed on 2026-10-12 with YOLO permissions. See FEATURE_PARITY.md for the completed host checks and remaining manual interaction acceptance.

## Explicit wbot service handoff

`scripts/deploy-wbot-handoff.mjs` is an operator-only migration utility, not an
automatic startup action. It reads the existing local wbot credentials without
printing them, backs up the legacy unit/session records, snapshots the built
runtime into a separate release directory and installs a new user service.
It creates a dedicated restricted `codex` parent channel and `wbot工程` private
topic, leaving trade notification settings unchanged. Configuration and state
are stored outside Git with `0600` permissions. It intentionally refuses existing
rollout manifests, matching parent channels or service units rather than overwriting.

After `npm run verify` and `npm run build`, explicitly run:

```bash
node scripts/deploy-wbot-handoff.mjs prepare
CODEX_DISCORD_ENV_FILE="$HOME/.config/discordgpt/discordgpt.env" \
  node scripts/verify-workspace-live.mjs "$HOME/.config/discordgpt/handoff.json"
```

The live acceptance starts one new Codex workspace thread and asks for a short
reply with no tools or file changes, then sends its result to the new topic. It
does not resume the legacy DM writer. The handoff must run in a separate systemd
transient service when the current conversation is owned by the old service:

```bash
systemd-run --user --unit=discordgpt-handoff \
  --property=StandardInput=null --property=UMask=0077 \
  /absolute/path/to/node /absolute/path/to/discordgpt/scripts/deploy-wbot-handoff.mjs handoff
```

The worker waits for all legacy pending flags to clear and a 15-second idle grace,
up to 20 minutes. It then stops/disables only the old chat service, refreshes the
DM mapping, starts/enables the independent service and checks Gateway-ready logs.
Success sends the topic link by DM; startup failure restores the old service.
Wait for the completion DM before sending a task in the newly-created topic.
Pending flags are not a durable delivery acknowledgment, so this is a guarded
operator migration, not a general zero-downtime message handoff protocol.

Inspect with `journalctl --user -u discordgpt-handoff -u discordgpt` and the
non-secret `~/.config/discordgpt/handoff.json` manifest. Secrets remain solely in
the protected instance configuration. A failed prepare may have created partial
Discord resources; inspect those before rerunning rather than deleting blindly.

## v0.4.0 upgrade and interaction ingress

The release restores the prior chat controls; see FEATURE_PARITY.md for
exact scope and acceptance status. `/model`, `/status`, `/ps`, `/stop`, `/compact`
and `/side` remain registered. New `/models`, `/usage`, `/cancel`, `/steer`,
`/resume`, `/topic`, `/workspaces`, `/reset` and `/help` are upserted without
removing unrelated global application commands. Catalog/usage refresh every five
minutes. Model settings are per conversation; explicit shared-thread windows
share the queue/settings. Task/system notices never start a Codex model turn.

If the Discord application has no HTTP interaction endpoint, Gateway controls
work without additional listeners. If an endpoint already exists (the wbot bot
previously used one), do **not** clear it: doing so can break business buttons.
Route a new public HTTPS path, for example `/v1/discordgpt/interactions`, to
`127.0.0.1:18875`, preserving the body and signature headers. Keep the old path
routed to the existing business handler. Set in the protected instance file:

```dotenv
DISCORD_INTERACTIONS_PORT=18875
DISCORD_PUBLIC_KEY=<Discord application public key, not a secret token>
DISCORD_INTERACTIONS_URL=https://your-existing-domain/v1/discordgpt/interactions
DISCORD_INTERACTIONS_FALLBACK_URL=https://your-existing-domain/v1/discord/interactions
```

The new ingress verifies Ed25519 signatures and timestamp freshness, immediately
acknowledges chat controls, and sends unrelated signed requests unchanged to the
old HTTPS handler. The reverse proxy is a host deployment prerequisite; this
repository does not modify another application's proxy files. The upgrader gets
the application public key and preserves the previous endpoint as fallback; it
refuses a loop or a missing ingress. Discord validates the new endpoint by a
signed PING when the application setting changes.

Run from the repository on a host with network and systemd access:

```bash
npm run verify
npm run smoke
node scripts/upgrade-service.mjs pack /tmp/discordgpt-0.4.0-candidate
node scripts/upgrade-service.mjs deploy /tmp/discordgpt-0.4.0-candidate
```

`pack` snapshots the built runtime, dependencies and checks; it is not an
acceptance certificate. `deploy` rechecks integrity, runs the complete tests and
real app-server smoke, preserves unit/config/state backups, drains modern
services, imports matching legacy DM model/effort and gates startup on fresh
Gateway/command/catalog/usage health. Failed startup or endpoint validation
restores the old unit/config/endpoint. It preserves current Codex state rather
than restoring stale bindings over completed work.

The current v0.3.0 service does not expose health/drain controls. Check
`!codex status` in **every** live conversation and wait for all tasks and queued
replies to finish before adding `--legacy-idle-confirmed` to the deploy command.
The tool refuses to stop an old service when that evidence is unavailable.
Modern upgrades use the `drain` marker and `health.json` and wait up to twenty
minutes; queued or quota-paused work is never discarded to speed up rollout.
During drain, new requests receive a clear restart message.

After rollout verify a real `/status`, a model change followed by a task, one
queue-card cancel/steer click, original DM context continuity, an independent
workspace topic, shutdown/startup notices and the preexisting business buttons.
Observe `journalctl --user -u discordgpt` and the private `health.json`/audit
journal. SIGKILL or total network loss cannot send an exit notification. Queues
remain memory-only as in the previous service; do not replay unknown side effects
after a crash. `/compact` and `/side` were placeholders in the old service and
continue to report their unsupported status explicitly.

`npm run test:offline` executes offline protocol, signed ingress and production
routing tests and explicitly skips six socket integration cases. It is useful in
a restricted development session, but cannot replace `npm run verify`, actual
app-server smoke or live Discord acceptance. The 2026-10-12 host session passed
the complete suite and deployed v0.4.0; the prior socket/systemd restrictions
applied only to the older Discord model session.


## Updating from a Discord model task

A model task cannot synchronously drain and stop the service running that same
task: its own outstanding request would keep the drain gate closed. Verify and
pack the candidate first, then launch the deploy command in a separate user
systemd unit and finish the Discord reply. The worker can then drain the finished
request and restart the bridge without killing its own deployment process:

```bash
systemd-run --user --collect --unit=discordgpt-upgrade-$(date +%s) \
  --property=StandardInput=null --property=UMask=0077 \
  --working-directory=/absolute/path/to/discordgpt \
  /absolute/path/to/node /absolute/path/to/discordgpt/scripts/upgrade-service.mjs \
  deploy /absolute/path/to/verified-candidate --yolo
```

Use an absolute Node path available to systemd. The v0.4.0 service supplies the
health/drain gate, so `--legacy-idle-confirmed` is unnecessary for future upgrades.
Check the worker journal and upgrade result manifest before reporting success.
An instruction to update grants the task scope; the deployed sandbox and service
user permissions must also permit the host operations.

The current host routes its dedicated ingress through a supervised SSH remote
Unix socket mounted into HAProxy. `discordgpt-ingress-tunnel.service` reconnects
on failure and starts with the bridge through a user-unit dependency. The socket
and HAProxy configuration remain host configuration outside this repository.
The existing business endpoint is retained as fallback; forwarded requests keep
the original signed body, signature headers and Discord User-Agent.
