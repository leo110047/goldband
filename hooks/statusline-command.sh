#!/usr/bin/env bash
# Claude Code status line — mirrors a Starship-style prompt with Claude context
input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')

# Shorten home directory to ~
home="$HOME"
short_cwd="${cwd/#$home/\~}"

# Build parts
parts=()

# Directory  📁
if [ -n "$short_cwd" ]; then
  parts+=("$(printf '\033[34m📁 %s\033[0m' "$short_cwd")")
fi

# Git branch  (nerd font branch icon)
branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)
if [ -n "$branch" ]; then
  parts+=("$(printf '\033[35m\ue0a0 %s\033[0m' "$branch")")
fi

# Model  🤖
if [ -n "$model" ]; then
  parts+=("$(printf '\033[36m🤖 %s\033[0m' "$model")")
fi

# Context usage  🧠
if [ -n "$used" ]; then
  used_int=${used%.*}
  if [ "$used_int" -ge 80 ]; then
    color='\033[31m'
  elif [ "$used_int" -ge 50 ]; then
    color='\033[33m'
  else
    color='\033[32m'
  fi
  parts+=("$(printf "${color}🧠 %s%%\033[0m" "$used_int")")
fi

# Vim mode
if [ -n "$vim_mode" ]; then
  parts+=("$(printf '\033[33m[%s]\033[0m' "$vim_mode")")
fi

# Subscription quota via Anthropic OAuth usage API (cached 60 s)
_quota_color() {
  local pct=$1
  if [ "$pct" -ge 80 ]; then
    printf '\033[31m'
  elif [ "$pct" -ge 50 ]; then
    printf '\033[33m'
  else
    printf '\033[32m'
  fi
}

QUOTA_CACHE="/tmp/claude_quota_cache.json"
now=$(date +%s)
cache_age=999999
if [ -f "$QUOTA_CACHE" ]; then
  cache_ts=$(python3 -c "import json,sys; d=json.load(open('$QUOTA_CACHE')); print(d.get('ts',0))" 2>/dev/null)
  [ -n "$cache_ts" ] && cache_age=$(( now - cache_ts ))
fi

if [ "$cache_age" -ge 60 ]; then
  # Fetch a fresh token from macOS Keychain
  raw_creds=$(security find-generic-password -s 'Claude Code-credentials' -w 2>/dev/null)
  if [ -n "$raw_creds" ]; then
    token=$(python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(d.get('claudeAiOauth', {}).get('accessToken', ''))
except Exception:
    pass
" <<< "$raw_creds" 2>/dev/null)
  fi

  if [ -n "$token" ]; then
    api_resp=$(curl -sf --max-time 3 \
      -H "Authorization: Bearer $token" \
      -H "anthropic-beta: oauth-2025-04-20" \
      "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)
    if [ -n "$api_resp" ]; then
      python3 -c "
import json, sys, time
d = json.loads(sys.stdin.read())
out = {'ts': int(time.time()), 'five_hour': d.get('five_hour', {}).get('utilization'), 'seven_day': d.get('seven_day', {}).get('utilization')}
print(json.dumps(out))
" <<< "$api_resp" > "$QUOTA_CACHE" 2>/dev/null
    fi
  fi
fi

# Read from cache (whether freshly fetched or previously stored)
if [ -f "$QUOTA_CACHE" ]; then
  read five_h seven_d <<< "$(python3 -c "
import json, sys
try:
    d = json.load(open('$QUOTA_CACHE'))
    fh = d.get('five_hour')
    sd = d.get('seven_day')
    fh_pct = int(round(fh)) if fh is not None else ''
    sd_pct = int(round(sd)) if sd is not None else ''
    print(fh_pct, sd_pct)
except Exception:
    print('', '')
" 2>/dev/null)"

  if [ -n "$five_h" ] && [ -n "$seven_d" ]; then
    c5=$(_quota_color "$five_h")
    c7=$(_quota_color "$seven_d")
    parts+=("$(printf "⚡${c5}Current:%d%%\033[0m  ${c7}Weekly:%d%%\033[0m" "$five_h" "$seven_d")")
  fi
fi

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
