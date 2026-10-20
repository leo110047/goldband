# This file is sourced by goldband git hooks.
#
# After a goldband hook finishes its own checks it chains, in order, to the
# preserved global hook `<hook dir>/<name>.local` and to the repository's own
# hook. The repository hook directory is the repository- or worktree-level
# `core.hooksPath` when it names a directory other than the goldband hook
# directory, otherwise `<git common dir>/hooks`. The goldband `core.hooksPath` environment override
# is removed before resolving it and before running chained hooks, so they
# observe the repository's own configuration.

# Hooks whose standard input carries Git data that every chained hook needs.
GOLDBAND_STDIN_HOOKS=" pre-push post-rewrite "

goldband_lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

goldband_strip_hooks_override() {
  local hook_dir="$1"
  local count="${GIT_CONFIG_COUNT:-0}"
  local index kept=0 key_var value_var key value
  case "$count" in
    '' | *[!0-9]*) return 0 ;;
  esac
  for ((index = 0; index < count; index++)); do
    key_var="GIT_CONFIG_KEY_$index"
    value_var="GIT_CONFIG_VALUE_$index"
    key="${!key_var-}"
    value="${!value_var-}"
    unset "$key_var" "$value_var"
    if [ "$(goldband_lowercase "$key")" = "core.hookspath" ] && [ "$value" -ef "$hook_dir" ]; then
      continue
    fi
    export "GIT_CONFIG_KEY_$kept=$key" "GIT_CONFIG_VALUE_$kept=$value"
    kept=$((kept + 1))
  done
  if [ "$kept" -eq 0 ]; then
    unset GIT_CONFIG_COUNT
  else
    export GIT_CONFIG_COUNT="$kept"
  fi
}

goldband_project_hooks_dir() {
  local repo_root="$1"
  local common_dir="$2"
  local hook_dir="$3"
  local scoped configured=""

  # Only repository and worktree configuration name the repository's hooks.
  scoped="$(git config --show-scope --type=path --get core.hooksPath 2>/dev/null || true)"
  case "$scoped" in
    local$'\t'* | worktree$'\t'*) configured="${scoped#*$'\t'}" ;;
  esac
  if [ -n "$configured" ] && ! [ "$configured" -ef "$hook_dir" ]; then
    case "$configured" in
      /*) printf '%s\n' "$configured" ;;
      *) printf '%s/%s\n' "$repo_root" "$configured" ;;
    esac
    return 0
  fi

  [ -n "$common_dir" ] || return 1
  case "$common_dir" in
    /*) printf '%s/hooks\n' "$common_dir" ;;
    *) printf '%s/%s/hooks\n' "$repo_root" "$common_dir" ;;
  esac
}

goldband_run_project_hook() {
  local repo_root="$1"
  local hook_dir="$2"
  local common_dir="$3"
  local hook_name="$4"
  shift 4

  [ "${GOLDBAND_PROJECT_HOOK_RUNNING:-0}" != "1" ] || return 0

  (
    goldband_strip_hooks_override "$hook_dir"
    project_dir="$(goldband_project_hooks_dir "$repo_root" "$common_dir" "$hook_dir")" || exit 0
    project_hook="$project_dir/$hook_name"

    [ -e "$project_hook" ] || exit 0
    if [ -d "$project_hook" ]; then
      echo "[goldband] WARNING: project $hook_name hook path is a directory, skipping: $project_hook" >&2
      exit 0
    fi
    if [ ! -f "$project_hook" ]; then
      echo "[goldband] WARNING: project $hook_name hook is not a regular file, skipping: $project_hook" >&2
      exit 0
    fi
    if [ ! -x "$project_hook" ]; then
      echo "[goldband] WARNING: project $hook_name hook exists but is not executable, skipping: $project_hook" >&2
      exit 0
    fi
    if [ "$project_hook" -ef "$hook_dir/$hook_name" ]; then
      exit 0
    fi

    GOLDBAND_PROJECT_HOOK_RUNNING=1 exec "$project_hook" "$@"
  )
}

goldband_run_preserved_hook() {
  local hook_dir="$1"
  local hook_name="$2"
  shift 2
  local preserved_hook="$hook_dir/$hook_name.local"

  [ -f "$preserved_hook" ] && [ -x "$preserved_hook" ] || return 0
  (
    goldband_strip_hooks_override "$hook_dir"
    GOLDBAND_PROJECT_HOOK_RUNNING=1 exec "$preserved_hook" "$@"
  )
}

goldband_chain_hooks() {
  local hook_dir="$1"
  local hook_name="$2"
  shift 2
  local repo_root git_info common_dir="" input_file

  repo_root="$(pwd)"
  git_info="$(git rev-parse --show-toplevel --git-common-dir 2>/dev/null || true)"
  if [ -n "$git_info" ]; then
    repo_root="${git_info%%$'\n'*}"
    common_dir="${git_info#*$'\n'}"
    [ "$common_dir" != "$git_info" ] || common_dir=""
  fi

  case "$GOLDBAND_STDIN_HOOKS" in
    *" $hook_name "*) ;;
    *)
      goldband_run_preserved_hook "$hook_dir" "$hook_name" "$@"
      goldband_run_project_hook "$repo_root" "$hook_dir" "$common_dir" "$hook_name" "$@"
      return
      ;;
  esac

  input_file="$(mktemp "${TMPDIR:-/tmp}/goldband-$hook_name.XXXXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -f '$input_file'" EXIT
  cat > "$input_file"
  goldband_run_preserved_hook "$hook_dir" "$hook_name" "$@" < "$input_file"
  goldband_run_project_hook "$repo_root" "$hook_dir" "$common_dir" "$hook_name" "$@" < "$input_file"
}
