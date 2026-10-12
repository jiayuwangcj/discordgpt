# wbot extraction plan

## Scope boundary

discordgpt owns only this flow:

```text
Discord Gateway -> authorization -> per-channel queue -> Codex app-server
                <- progress/final renderer <- persistent thread state
```

It must not import wbot packages or read wbot databases/configuration. Bot
tokens, allowlists, thread bindings, logs, and attachments live under a
dedicated discordgpt state directory.

## Available in the initial standalone baseline

- Direct messages and mention-gated guild channels.
- Explicit user/channel allowlists.
- Persistent Codex thread per Discord channel.
- One active turn per channel with FIFO queueing.
- Shared local app-server mode for terminal/Discord thread continuity.
- Stop, reset, status, and opt-in Discord history commands.
- PNG/JPEG/WebP multimodal inputs and bounded downloads.
- Paragraph-oriented progress and final-answer delivery.
- YOLO `danger-full-access` and `approvalPolicy=never` defaults for new and bound conversations; explicit instance permissions override defaults.

## Migration gates

1. **Recovery and writer ownership**
   - Reconnect and re-read thread state after transport loss.
   - Detect an external writer and queue without stealing ownership.
   - Persist in-flight turn identity and recover after process restart.
2. **Conversation operations**
   - Dynamic `model/list` catalog and reasoning-effort selection: implemented in v0.4.0.
   - Account usage/status projection without exposing credentials: implemented in v0.4.0.
   - Late-result delivery for turns longer than the Discord request wait.
   - Interrupt, steer, queue withdrawal, and queue status: implemented in v0.4.0.
3. **Discord product behavior**
   - Paragraph/link-safe 1,900-character chunking: implemented in v0.1.1; code-fence-aware continuation remains future work.
   - One disposable queue-status message, removed after completion.
   - Append-only JSONL audit journal with rotation and redaction: metadata journal implemented in v0.4.0.
   - Completion-only final replies by default; progress is opt-in: implemented in v0.1.1.
4. **Operations**
   - `doctor`, config validation, health heartbeat, and supervised service files.
   - Restart/recovery integration tests against a fake app-server and Discord API.
   - Import tool for existing wbot channel-to-thread bindings.

Removal from wbot happens only after the standalone service passes a live DM
smoke test and its persisted thread resumes from both Discord and Codex TUI.

See FEATURE_PARITY.md for lifecycle, interaction ingress, multi-window semantics and outstanding live acceptance. The original handoff and the v0.4.0 host upgrade completed. Full tests, native context resumes and Discord endpoint validation passed; manual command/button acceptance remains separate.
