#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 THREAD_ID /absolute/path/to/instance.env" >&2
  exit 2
fi

thread_id=$1
instance_env=$(realpath "$2")
if [[ ! "$thread_id" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Invalid thread ID" >&2
  exit 2
fi

# Source only the explicitly supplied instance file. Never read ~/.env.
set -a
source "$instance_env"
set +a

: "${CODEX_PROJECT_DIR:?CODEX_PROJECT_DIR is required}"
: "${CODEX_APP_SERVER_URL:?CODEX_APP_SERVER_URL is required}"
codex_bin=${CODEX_BIN:-codex}

args=(resume --remote "$CODEX_APP_SERVER_URL" --cd "$CODEX_PROJECT_DIR")
if [[ -n "${CODEX_APP_SERVER_TOKEN:-}" ]]; then
  export CODEX_DISCORD_REMOTE_TOKEN="$CODEX_APP_SERVER_TOKEN"
  args+=(--remote-auth-token-env CODEX_DISCORD_REMOTE_TOKEN)
fi
args+=("$thread_id")
exec "$codex_bin" "${args[@]}"
