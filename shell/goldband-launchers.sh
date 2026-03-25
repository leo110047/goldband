#!/usr/bin/env bash

if [ -n "${GOLDBAND_SHELL_LAUNCHERS_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
GOLDBAND_SHELL_LAUNCHERS_LOADED=1

_goldband_self_update_bin() {
  if [ -n "${GOLDBAND_SELF_UPDATE_BIN:-}" ]; then
    printf '%s\n' "$GOLDBAND_SELF_UPDATE_BIN"
  else
    printf '%s\n' "$HOME/.claude/bin/goldband-self-update"
  fi
}

_goldband_prelaunch_update() {
  local command_name="${1:-}"
  local update_bin
  update_bin="$(_goldband_self_update_bin)"
  if [ -x "$update_bin" ]; then
    "$update_bin" "$command_name" || true
  fi
}

claude() {
  _goldband_prelaunch_update "claude"
  command claude "$@"
}

codex() {
  _goldband_prelaunch_update "codex"
  command codex "$@"
}
