#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 INSTANCE_ENV USER_IDS CHANNEL_IDS" >&2
  exit 2
fi
env_file=$1
users=$2
channels=$3

[[ -f "$env_file" ]] || { echo "Config not found: $env_file" >&2; exit 1; }
[[ "$users" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "Invalid user ID list" >&2; exit 2; }
[[ -z "$channels" || "$channels" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "Invalid channel ID list" >&2; exit 2; }

temp=$(mktemp "$(dirname "$env_file")/.instance.env.XXXXXX")
trap 'unlink "$temp" 2>/dev/null || true' EXIT
awk -v users="$users" -v channels="$channels" '
  /^DISCORD_ALLOWED_USER_IDS=/ { print "DISCORD_ALLOWED_USER_IDS=" users; seen_users=1; next }
  /^DISCORD_ALLOWED_CHANNEL_IDS=/ { print "DISCORD_ALLOWED_CHANNEL_IDS=" channels; seen_channels=1; next }
  { print }
  END {
    if (!seen_users) print "DISCORD_ALLOWED_USER_IDS=" users
    if (!seen_channels) print "DISCORD_ALLOWED_CHANNEL_IDS=" channels
  }
' "$env_file" >"$temp"
chmod 600 "$temp"
mv "$temp" "$env_file"
trap - EXIT
echo "✅ Updated Discord allowlists in $env_file"
echo "   Restart codex-dc for the change to take effect."
