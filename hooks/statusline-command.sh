#!/usr/bin/env bash
# Claude Code status line — mirrors a Starship-style prompt with Claude context
input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
used=$(echo "$input" | jq -r '.context_window.used_percentage // "0"')
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')

# Shorten home directory to ~
home="$HOME"
short_cwd="$cwd"
[[ -n "$home" && ( "$cwd" == "$home" || "$cwd" == "$home"/* ) ]] && short_cwd="~${cwd#"$home"}"

# Block progress bar, one cell per 10%  e.g. ████░░░░░░ for 40%; the empty part is dimmed so a
# low percentage does not read as a full bar.
_progress_bar() {
  local pct=$1
  local width=10
  (( pct > 100 )) && pct=100
  local filled=$(( (pct * width + 50) / 100 ))
  local empty=$(( width - filled ))
  local bar="" rest=""
  local i
  for (( i=0; i<filled; i++ )); do bar="${bar}█"; done
  for (( i=0; i<empty;  i++ )); do rest="${rest}░"; done
  printf '%s\033[90m%s\033[32m' "$bar" "$rest"
}

# Time until a quota window resets, at most two units  e.g. 27m, 4h 12m, 2d 14h
_until() {
  local secs=$(( $1 - now ))
  (( secs < 0 )) && secs=0
  local d=$(( secs / 86400 )) h=$(( secs % 86400 / 3600 )) m=$(( secs % 3600 / 60 ))
  if (( d > 0 )); then
    printf '%dd %dh' "$d" "$h"
  elif (( h > 0 )); then
    printf '%dh %dm' "$h" "$m"
  else
    printf '%dm' "$m"
  fi
}

# Build parts
parts=()

# Directory  📁
if [ -n "$short_cwd" ]; then
  parts+=("$(printf '\033[34m📁 %s\033[0m' "$short_cwd")")
fi

# Git branch  (nerd font branch icon via $'...' to ensure correct byte output)
branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)
if [ -n "$branch" ]; then
  branch_icon='🌲'
  parts+=("$(printf '\033[35m%s %s\033[0m' "$branch_icon" "$branch")")
fi

# Model  🤖  with reasoning effort, when the model supports it
if [ -n "$model" ]; then
  model_text=$(printf '\033[36m🤖 %s' "$model")
  [ -n "$effort" ] && model_text="${model_text}$(printf ' %s' "$effort")"
  parts+=("${model_text}$(printf '\033[0m')")
fi

# Context usage  🧠  (always shown, even at 0%)
used_int=${used%.*}
parts+=("$(printf '\033[33m🧠 %s%%\033[0m' "$used_int")")

# Vim mode
if [ -n "$vim_mode" ]; then
  parts+=("$(printf '\033[33m[%s]\033[0m' "$vim_mode")")
fi

# Subscription quota from Claude Code's rate_limits input (claude.ai Pro/Max,
# after the session's first API response). Each window may be absent.
now=$(date +%s)

# Each window is its own segment: icon, usage bar, used %, and
# (time to reset), matching the icon + value grammar of the other segments.
_quota_part() {
  local icon=$1 window=$2
  local pct reset text
  read -r pct reset <<< "$(echo "$input" | jq -r --arg w "$window" '
    .rate_limits[$w] // empty
    | select(.used_percentage != null)
    | "\(.used_percentage | round) \(.resets_at // "-")"')"
  [ -n "$pct" ] || return 0
  text=$(printf '%s \033[32m%s %d%%' "$icon" "$(_progress_bar "$pct")" "$pct")
  [ "$reset" != "-" ] && text="${text}$(printf ' (%s)' "$(_until "${reset%.*}")")"
  printf '%s\033[0m' "$text"
}

for quota in "⏳ five_hour" "📅 seven_day"; do
  read -r icon window <<< "$quota"
  part=$(_quota_part "$icon" "$window")
  [ -n "$part" ] && parts+=("$part")
done

# Join with separator
sep="$(printf '\033[90m │ \033[0m')"
out=""
for part in "${parts[@]}"; do
  if [ -z "$out" ]; then
    out="$part"
  else
    out="${out}${sep}${part}"
  fi
done
printf '%s' "$out"
