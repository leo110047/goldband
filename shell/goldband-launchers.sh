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

_goldband_runtime_bin() {
  local candidate
  local candidates=("$HOME/.codex/goldband/workflow-runtime/bin/goldband" "$HOME/.claude/skills/goldband/bin/goldband")
  if [ -n "${CLAUDECODE:-}${CLAUDE_PLUGIN_ROOT:-}" ]; then
    candidates=("$HOME/.claude/skills/goldband/bin/goldband")
  elif [ -n "${CODEX_THREAD_ID:-}${CODEX_HOME:-}" ]; then
    candidates=("$HOME/.codex/goldband/workflow-runtime/bin/goldband")
  fi
  for candidate in "${candidates[@]}"
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

goldband() {
  local runtime_bin
  if ! runtime_bin="$(_goldband_runtime_bin)"; then
    echo "goldband: workflow runtime is not installed; run ./install.sh workflow-auto" >&2
    return 127
  fi
  "$runtime_bin" "$@"
}

claude() {
  _goldband_prelaunch_update "claude"
  command claude "$@"
}

codex() {
  _goldband_prelaunch_update "codex"
  command codex "$@"
}
