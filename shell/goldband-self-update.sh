#!/usr/bin/env bash
set -euo pipefail

resolve_script_path() {
  local source_path="${BASH_SOURCE[0]}"
  while [ -L "$source_path" ]; do
    local source_dir
    source_dir="$(cd -P "$(dirname "$source_path")" && pwd)"
    source_path="$(readlink "$source_path")"
    case "$source_path" in
      /*) ;;
      *) source_path="$source_dir/$source_path" ;;
    esac
  done
  cd -P "$(dirname "$source_path")" && pwd
}

resolve_repo_dir() {
  if [ -n "${GOLDBAND_SELF_UPDATE_REPO_DIR:-}" ]; then
    printf '%s\n' "$GOLDBAND_SELF_UPDATE_REPO_DIR"
    return 0
  fi

  local script_dir
  script_dir="$(resolve_script_path)"
  cd "$script_dir/.." && pwd
}

run_git_with_timeout() {
  local repo_dir="$1"
  shift
  local timeout_seconds="${GOLDBAND_SELF_UPDATE_TIMEOUT:-4}"

  if ! command -v python3 >/dev/null 2>&1; then
    (
      cd "$repo_dir" &&
      GIT_TERMINAL_PROMPT=0 "$@" >/dev/null 2>&1
    )
    return $?
  fi

  python3 - "$timeout_seconds" "$repo_dir" "$@" <<'PY'
import os
import subprocess
import sys

timeout = float(sys.argv[1])
cwd = sys.argv[2]
cmd = sys.argv[3:]
env = os.environ.copy()
env["GIT_TERMINAL_PROMPT"] = "0"

try:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
except subprocess.TimeoutExpired:
    sys.exit(124)

sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
sys.exit(result.returncode)
PY
}

main() {
  local repo_dir
  repo_dir="$(resolve_repo_dir)" || exit 0

  git -C "$repo_dir" rev-parse --git-dir >/dev/null 2>&1 || exit 0

  local branch upstream dirty_status
  branch="$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  upstream="$(git -C "$repo_dir" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

  [ "$branch" = "main" ] || exit 0
  [ "$upstream" = "origin/main" ] || exit 0

  dirty_status="$(git -C "$repo_dir" status --porcelain 2>/dev/null || true)"
  [ -z "$dirty_status" ] || exit 0

  run_git_with_timeout "$repo_dir" git fetch --quiet origin main >/dev/null 2>&1 || exit 0

  local counts ahead behind
  counts="$(git -C "$repo_dir" rev-list --left-right --count HEAD...origin/main 2>/dev/null || true)"
  ahead="$(printf '%s\n' "$counts" | awk '{print $1}')"
  behind="$(printf '%s\n' "$counts" | awk '{print $2}')"

  [ "${behind:-0}" -gt 0 ] || exit 0
  [ "${ahead:-0}" -eq 0 ] || exit 0

  local old_head new_head
  old_head="$(git -C "$repo_dir" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
  run_git_with_timeout "$repo_dir" git pull --ff-only --quiet origin main >/dev/null 2>&1 || exit 0
  new_head="$(git -C "$repo_dir" rev-parse --short HEAD 2>/dev/null || echo "unknown")"

  if [ "$new_head" != "$old_head" ]; then
    printf '[goldband] updated %s -> %s; new sessions will use the latest config.\n' "$old_head" "$new_head" >&2
  fi
}

main "$@"
