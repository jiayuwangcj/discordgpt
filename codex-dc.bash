# Shell functions for one Discord bot + one directly visible Codex TUI per project.
#
# This file is intentionally NOT installed into ~/.bashrc automatically.
# State and secrets live under ${CODEX_DISCORD_STATE_ROOT:-$HOME/.codex-discord}, separate
# from Claude Code's ~/.claude-discord/ and from ~/.env.

unalias codex-dc codex-dc-init codex-dc-alt codex-dc-allow codex-dc-status 2>/dev/null

_codex_dc_root() {
  printf '%s\n' "${CODEX_DISCORD_STATE_ROOT:-$HOME/.codex-discord}"
}

_codex_dc_repo() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

_codex_dc_state() {
  local variant="${1:-}"
  local suffix="$(basename "$PWD")"
  [[ -n "$variant" ]] && suffix="${suffix}-${variant}"
  printf '%s/%s\n' "$(_codex_dc_root)" "$suffix"
}

_codex_dc_run() {
  local variant="$1"
  shift
  local state repo
  state=$(_codex_dc_state "$variant")
  repo=$(_codex_dc_repo)
  if [[ ! -f "$state/instance.env" ]]; then
    echo "⚠️  $state/instance.env not found" >&2
    if [[ -n "$variant" ]]; then
      echo "   Initialize it with: codex-dc-init $variant" >&2
    else
      echo "   Initialize it with: codex-dc-init" >&2
    fi
    return 1
  fi
  "$repo/scripts/run-direct.sh" "$state/instance.env" "$@"
}

codex-dc() {
  _codex_dc_run "" "$@"
}

codex-dc-alt() {
  local variant
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    variant="$1"
    shift
  else
    variant="2"
  fi
  _codex_dc_run "$variant" "$@"
}

codex-dc-init() {
  local variant=""
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then variant="$1"; fi
  local state suffix default_port token users channels port
  state=$(_codex_dc_state "$variant")
  suffix=$(basename "$state")
  mkdir -p "$state"
  chmod 700 "$state"
  if [[ -e "$state/instance.env" ]]; then
    echo "⚠️  Refusing to overwrite existing $state/instance.env" >&2
    echo "   Move it aside manually if you truly want to reinitialize." >&2
    return 1
  fi

  echo "Discord bot token (input hidden):"
  read -r -s token
  echo
  [[ -z "$token" || "$token" == *$'\n'* ]] && { echo "Invalid empty token" >&2; return 1; }

  echo "Allowed Discord user ID(s), comma-separated (required):"
  read -r users
  if [[ ! "$users" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
    echo "Invalid Discord user ID list" >&2
    return 1
  fi

  echo "Allowed Discord channel ID(s), comma-separated (optional; Enter allows any visible channel):"
  read -r channels
  if [[ -n "$channels" && ! "$channels" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
    echo "Invalid Discord channel ID list" >&2
    return 1
  fi

  default_port=$((4500 + $(printf '%s' "$suffix" | cksum | awk '{print $1}') % 1000))
  echo "Local app-server port [$default_port]:"
  read -r port
  port=${port:-$default_port}
  if [[ ! "$port" =~ ^[0-9]+$ || "$port" -lt 1024 || "$port" -gt 65535 ]]; then
    echo "Invalid TCP port" >&2
    return 1
  fi

  {
    printf 'DISCORD_BOT_TOKEN=%s\n' "$token"
    printf 'DISCORD_ALLOWED_USER_IDS=%s\n' "$users"
    printf 'DISCORD_ALLOWED_CHANNEL_IDS=%s\n' "$channels"
    printf 'DISCORD_REQUIRE_MENTION=true\n\n'
    printf 'CODEX_PROJECT_DIR=%s\n' "$PWD"
    printf 'CODEX_APP_SERVER_URL=ws://127.0.0.1:%s\n' "$port"
    printf 'CODEX_SANDBOX=workspace-write\n'
    printf 'CODEX_APPROVAL_POLICY=never\n'
    printf 'CODEX_DISCORD_STATE_DIR=%s/runtime\n' "$state"
  } >"$state/instance.env"
  chmod 600 "$state/instance.env"
  echo "✅ Saved isolated Codex bot config to $state/instance.env"
  if [[ -n "$variant" ]]; then
    echo "   Start with: codex-dc-alt $variant"
  else
    echo "   Start with: codex-dc"
  fi
}

codex-dc-allow() {
  if [[ $# -lt 1 || $# -gt 3 ]]; then
    echo "Usage: codex-dc-allow USER_IDS [CHANNEL_IDS] [VARIANT]" >&2
    return 2
  fi
  local users="$1" channels="${2:-}" variant="${3:-}" state repo
  state=$(_codex_dc_state "$variant")
  repo=$(_codex_dc_repo)
  "$repo/scripts/update-allow.sh" "$state/instance.env" "$users" "$channels"
}

codex-dc-status() {
  local variant=""
  [[ "${1:-}" =~ ^[0-9]+$ ]] && variant="$1"
  local state pid label
  state=$(_codex_dc_state "$variant")
  echo "state:  $state"
  [[ -s "$state/thread-id" ]] && echo "thread: $(<"$state/thread-id")" || echo "thread: not created"
  for label in app-server bridge; do
    if [[ -s "$state/$label.pid" ]]; then
      pid=$(<"$state/$label.pid")
      if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
        echo "$label: running (PID $pid)"
      else
        echo "$label: stale PID file ($pid)"
      fi
    else
      echo "$label: stopped"
    fi
  done
  [[ -f "$state/logs/bridge.log" ]] && echo "logs:   $state/logs"
}
