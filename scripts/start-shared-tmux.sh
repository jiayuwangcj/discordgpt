#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 /absolute/path/to/instance.env [tmux-session-name]" >&2
  exit 2
fi

instance_env=$(realpath "$1")
session_name=${2:-codex-discord}
if [[ ! -f "$instance_env" ]]; then
  echo "Instance env file not found: $instance_env" >&2
  exit 1
fi
if [[ ! "$session_name" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "tmux session name may contain only letters, numbers, _ and -" >&2
  exit 2
fi

# Source only the explicitly supplied instance file. Never read ~/.env.
set -a
source "$instance_env"
set +a

: "${CODEX_PROJECT_DIR:?CODEX_PROJECT_DIR is required in the instance env file}"
: "${CODEX_APP_SERVER_URL:?CODEX_APP_SERVER_URL is required in shared mode}"
codex_bin=${CODEX_BIN:-codex}

if [[ "$CODEX_APP_SERVER_URL" != ws://127.0.0.1:* && "$CODEX_APP_SERVER_URL" != ws://localhost:* ]]; then
  echo "Refusing non-local app-server URL without an explicit TLS/auth setup: $CODEX_APP_SERVER_URL" >&2
  exit 1
fi
if tmux has-session -t "$session_name" 2>/dev/null; then
  echo "tmux session already exists: $session_name" >&2
  exit 1
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
printf -v server_cmd 'cd %q && exec %q app-server --listen %q' "$CODEX_PROJECT_DIR" "$codex_bin" "$CODEX_APP_SERVER_URL"
printf -v bridge_cmd 'cd %q && CODEX_DISCORD_ENV_FILE=%q exec node --env-file=%q dist/index.js' "$repo_dir" "$instance_env" "$instance_env"

tmux new-session -d -s "$session_name" -n agent -c "$CODEX_PROJECT_DIR" "$server_cmd"
tmux split-window -v -t "$session_name:agent" -c "$repo_dir" "$bridge_cmd"
tmux split-window -h -t "$session_name:agent.0" -c "$CODEX_PROJECT_DIR"
tmux select-layout -t "$session_name:agent" tiled

echo "Started shared Codex session: $session_name"
echo "Attach with: tmux attach -t $session_name"
echo "After Discord creates a thread, run in the shell pane:"
echo "  $repo_dir/scripts/attach-thread.sh <THREAD_ID> $instance_env"
