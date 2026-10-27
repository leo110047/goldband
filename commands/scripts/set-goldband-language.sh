#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"

find_workflow_config_bin() {
  local candidate
  for candidate in \
    "$HOME/.codex/skills/goldband/bin/goldband-config" \
    "$HOME/.claude/skills/goldband/bin/goldband-config" \
    "$REPO_DIR/goldband-loop/bin/goldband-config"
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

normalize_language() {
  local value="${1:-}"
  case "$value" in
    zh-TW|zh|tw|中文|繁中) printf 'zh-TW\n' ;;
    en|english|英文) printf 'en\n' ;;
    *) return 1 ;;
  esac
}

# Unset means the zh-TW default; a failed read is an error, not the default.
read_language() {
  local workflow_config_bin="$1"
  local current
  current="$("$workflow_config_bin" get goldband_language)" || {
    echo "failed to read goldband_language" >&2
    return 1
  }
  if [ -n "$current" ]; then
    printf '%s\n' "$current"
  else
    printf 'zh-TW\n'
  fi
}

main() {
  local mode="${1:-get}"
  local requested="${2:-}"
  local workflow_config_bin
  local normalized
  local current

  # Exit 3 tells callers Goldband Loop is not installed.
  workflow_config_bin="$(find_workflow_config_bin)" || {
    echo "Goldband Loop config binary not found" >&2
    exit 3
  }

  case "$mode" in
    get)
      read_language "$workflow_config_bin" || exit 1
      ;;
    set|sync)
      # Exit 2 tells callers the language is not supported.
      normalized="$(normalize_language "$requested")" || {
        echo "unsupported language: ${requested:-<empty>}" >&2
        exit 2
      }
      "$workflow_config_bin" set goldband_language "$normalized" || {
        echo "failed to write goldband_language" >&2
        exit 1
      }
      current="$(read_language "$workflow_config_bin")" || exit 1
      if [ "$current" != "$normalized" ]; then
        echo "goldband_language readback is ${current}, expected ${normalized}" >&2
        exit 1
      fi
      printf '%s\n' "$current"
      ;;
    *)
      echo "usage: $0 {get|set <zh-TW|en>|sync <zh-TW|en>}" >&2
      exit 1
      ;;
  esac
}

main "$@"
