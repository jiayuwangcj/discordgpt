#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /absolute/path/to/instance.env [codex resume arguments...]" >&2
  exit 2
fi

instance_env=$(realpath "$1")
shift
state_dir=$(dirname "$instance_env")
repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Source exactly one explicit instance file; never read ~/.env.
set -a
source "$instance_env"
set +a

: "${DISCORD_BOT_TOKEN:?Run codex-dc-init first; DISCORD_BOT_TOKEN is missing}"
: "${DISCORD_ALLOWED_USER_IDS:?DISCORD_ALLOWED_USER_IDS is required}"
: "${CODEX_PROJECT_DIR:?CODEX_PROJECT_DIR is required}"
: "${CODEX_APP_SERVER_URL:?CODEX_APP_SERVER_URL is required}"
codex_bin=${CODEX_BIN:-codex}
sandbox=${CODEX_SANDBOX:-workspace-write}
approval=${CODEX_APPROVAL_POLICY:-never}
model=${CODEX_MODEL:-}

if [[ "$CODEX_APP_SERVER_URL" != ws://127.0.0.1:* && "$CODEX_APP_SERVER_URL" != ws://localhost:* ]]; then
  echo "Refusing non-local app-server URL: $CODEX_APP_SERVER_URL" >&2
  exit 1
fi
if [[ ! -f "$repo_dir/dist/index.js" || ! -f "$repo_dir/dist/bootstrap-thread.js" ]]; then
  echo "Build missing. Run: cd $repo_dir && npm run build" >&2
  exit 1
fi

for pid_file in "$state_dir/app-server.pid" "$state_dir/bridge.pid"; do
  if [[ -s "$pid_file" ]]; then
    old_pid=$(<"$pid_file")
    if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "A codex-dc process is already running (PID $old_pid; $pid_file)." >&2
      echo "Use codex-dc-status, or exit the existing Codex TUI first." >&2
      exit 1
    fi
  fi
done

app_pid=""
bridge_pid=""
cleanup() {
  trap - EXIT INT TERM
  [[ -n "$bridge_pid" ]] && kill "$bridge_pid" 2>/dev/null || true
  [[ -n "$app_pid" ]] && kill "$app_pid" 2>/dev/null || true
  wait "$bridge_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  unlink "$state_dir/bridge.pid" 2>/dev/null || true
  unlink "$state_dir/app-server.pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$state_dir/logs"
chmod 700 "$state_dir" "$state_dir/logs"
"$codex_bin" app-server --listen "$CODEX_APP_SERVER_URL" \
  >>"$state_dir/logs/app-server.log" 2>&1 &
app_pid=$!
printf '%s\n' "$app_pid" >"$state_dir/app-server.pid"

health_url=${CODEX_APP_SERVER_URL/ws:\/\//http:\/\/}
for _ in {1..100}; do
  if curl --silent --fail "$health_url/readyz" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "Codex app-server exited during startup. See $state_dir/logs/app-server.log" >&2
    exit 1
  fi
  sleep 0.1
done
if ! curl --silent --fail "$health_url/readyz" >/dev/null 2>&1; then
  echo "Timed out waiting for Codex app-server at $CODEX_APP_SERVER_URL" >&2
  exit 1
fi

existing_thread=""
[[ -s "$state_dir/thread-id" ]] && existing_thread=$(<"$state_dir/thread-id")
thread_id=$(CODEX_APP_SERVER_TOKEN="${CODEX_APP_SERVER_TOKEN:-}" node "$repo_dir/dist/bootstrap-thread.js" \
  "$CODEX_APP_SERVER_URL" "$CODEX_PROJECT_DIR" "$sandbox" "$approval" "$model" "$existing_thread")
printf '%s\n' "$thread_id" >"$state_dir/thread-id"
chmod 600 "$state_dir/thread-id"

CODEX_SHARED_THREAD_ID="$thread_id" CODEX_DISCORD_ENV_FILE="$instance_env" \
  node --env-file="$instance_env" "$repo_dir/dist/index.js" \
  >>"$state_dir/logs/bridge.log" 2>&1 &
bridge_pid=$!
printf '%s\n' "$bridge_pid" >"$state_dir/bridge.pid"

echo "Codex Discord bot started"
echo "  project: $CODEX_PROJECT_DIR"
echo "  thread:  $thread_id"
echo "  logs:    $state_dir/logs"
echo "Exiting this Codex TUI will stop its Discord bridge."

remote_args=(resume --remote "$CODEX_APP_SERVER_URL" --cd "$CODEX_PROJECT_DIR")
if [[ -n "${CODEX_APP_SERVER_TOKEN:-}" ]]; then
  export CODEX_DISCORD_REMOTE_TOKEN="$CODEX_APP_SERVER_TOKEN"
  remote_args+=(--remote-auth-token-env CODEX_DISCORD_REMOTE_TOKEN)
fi
remote_args+=("$thread_id")
exec </dev/tty
"$codex_bin" "${remote_args[@]}" "$@"
