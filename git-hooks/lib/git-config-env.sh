# Sourced by the shell startup block that `./install.sh style-gate` writes,
# with the goldband hook directory as $1: an argument to `.` in zsh and bash,
# or the caller's first positional parameter in a POSIX sh, whose `.` takes no
# arguments. It appends core.hooksPath=<that directory> to Git's environment
# configuration, which takes precedence over repository-local core.hooksPath;
# the goldband hooks then chain to the repository's own hooks. Shells started
# inside a chained hook (GOLDBAND_PROJECT_HOOK_RUNNING=1) keep the override
# removed.

goldband_hooks_dir="${1:-}"
if [ "${GOLDBAND_PROJECT_HOOK_RUNNING:-0}" != "1" ] \
  && [ -n "$goldband_hooks_dir" ] && [ -d "$goldband_hooks_dir" ]; then
  goldband_count="${GIT_CONFIG_COUNT:-0}"
  case "$goldband_count" in
    '' | *[!0-9]*) goldband_count="" ;;
  esac
  if [ -n "$goldband_count" ]; then
    goldband_index=0
    goldband_found=0
    while [ "$goldband_index" -lt "$goldband_count" ]; do
      eval "goldband_key=\${GIT_CONFIG_KEY_$goldband_index:-}"
      eval "goldband_value=\${GIT_CONFIG_VALUE_$goldband_index:-}"
      if [ "$goldband_key" = "core.hooksPath" ] && [ "$goldband_value" = "$goldband_hooks_dir" ]; then
        goldband_found=1
      fi
      goldband_index=$((goldband_index + 1))
    done
    if [ "$goldband_found" = 0 ]; then
      export "GIT_CONFIG_KEY_$goldband_count=core.hooksPath"
      export "GIT_CONFIG_VALUE_$goldband_count=$goldband_hooks_dir"
      export GIT_CONFIG_COUNT=$((goldband_count + 1))
    fi
  fi
  unset goldband_count goldband_index goldband_found goldband_key goldband_value
fi
unset goldband_hooks_dir
