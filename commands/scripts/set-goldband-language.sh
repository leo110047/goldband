#!/usr/bin/env bash
set -euo pipefail

find_workflow_config_bin() {
  local candidate
  for candidate in \
    "$HOME/.codex/skills/workflow/bin/workflow-config" \
    "$HOME/.claude/skills/workflow/bin/workflow-config"
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

read_language() {
  local workflow_config_bin="$1"
  local current
  current="$("$workflow_config_bin" get goldband_language 2>/dev/null || true)"
  if [ -n "$current" ]; then
    printf '%s\n' "$current"
  else
    printf 'zh-TW\n'
  fi
}

wrapper_description() {
  local wrapper_name="$1"
  local language="$2"
  case "$wrapper_name:$language" in
    goldband-autoplan:en) printf '%s\n' 'Automated end-to-end plan review workflow.' ;;
    goldband-benchmark:en) printf '%s\n' 'Performance baselines and regression checks.' ;;
    goldband-browse:en) printf '%s\n' 'Real Chromium browser tooling.' ;;
    goldband-canary:en) printf '%s\n' 'Post-release observation and rapid verification.' ;;
    goldband-careful:en) printf '%s\n' 'Prompt before high-risk operations.' ;;
    goldband-codex:en) printf '%s\n' 'Use Codex for a second-opinion review.' ;;
    goldband-cso:en) printf '%s\n' 'Deep security review.' ;;
    goldband-design-consultation:en) printf '%s\n' 'Design direction and system planning.' ;;
    goldband-design-review:en) printf '%s\n' 'Design review and correction.' ;;
    goldband-document-release:en) printf '%s\n' 'Sync README and release docs.' ;;
    goldband-freeze:en) printf '%s\n' 'Limit edit scope to avoid changing too much.' ;;
    goldband-guard:en) printf '%s\n' 'Combined careful and freeze task guardrails.' ;;
    goldband-investigate:en) printf '%s\n' 'Systematic debugging and root-cause investigation.' ;;
    goldband-land-and-deploy:en) printf '%s\n' 'Merge, deploy, and post-launch verification.' ;;
    goldband-office-hours:en) printf '%s\n' 'Reframe the problem from a product perspective.' ;;
    goldband-plan-ceo-review:en) printf '%s\n' 'Review the plan from a CEO perspective.' ;;
    goldband-plan-design-review:en) printf '%s\n' 'Design review before implementation.' ;;
    goldband-plan-eng-review:en) printf '%s\n' 'Engineering review before implementation.' ;;
    goldband-qa:en) printf '%s\n' 'Browser-based QA and verification.' ;;
    goldband-qa-only:en) printf '%s\n' 'Test only, no fixes; output a bug report.' ;;
    goldband-review:en) printf '%s\n' 'Pre-landing review for the current diff.' ;;
    goldband-retro:en) printf '%s\n' 'Review recent output and improvement directions.' ;;
    goldband-setup-browser-cookies:en) printf '%s\n' 'Import browser cookies for QA.' ;;
    goldband-setup-deploy:en) printf '%s\n' 'Configure deploy and production verification info.' ;;
    goldband-ship:en) printf '%s\n' 'Release and open a PR.' ;;
    goldband-unfreeze:en) printf '%s\n' 'Remove freeze restrictions.' ;;
    goldband-autoplan:*) printf '%s\n' '自動跑完整計畫審查流程。' ;;
    goldband-benchmark:*) printf '%s\n' '效能基準與回歸檢查。' ;;
    goldband-browse:*) printf '%s\n' '真實 Chromium 瀏覽器工具。' ;;
    goldband-canary:*) printf '%s\n' '發版後觀察與快速驗證。' ;;
    goldband-careful:*) printf '%s\n' '高風險操作前提醒確認。' ;;
    goldband-codex:*) printf '%s\n' '用 Codex 做第二意見 review。' ;;
    goldband-cso:*) printf '%s\n' '深度安全審查。' ;;
    goldband-design-consultation:*) printf '%s\n' '設計方向與系統規劃。' ;;
    goldband-design-review:*) printf '%s\n' '設計審查與修正。' ;;
    goldband-document-release:*) printf '%s\n' '同步更新 README 與發版文件。' ;;
    goldband-freeze:*) printf '%s\n' '限制編輯範圍，避免改太多。' ;;
    goldband-guard:*) printf '%s\n' 'careful + freeze 的任務保護。' ;;
    goldband-investigate:*) printf '%s\n' '系統化除錯與根因調查。' ;;
    goldband-land-and-deploy:*) printf '%s\n' 'merge、deploy、上線後驗證。' ;;
    goldband-office-hours:*) printf '%s\n' '從產品角度重想問題與方向。' ;;
    goldband-plan-ceo-review:*) printf '%s\n' '用 CEO 視角重審計畫。' ;;
    goldband-plan-design-review:*) printf '%s\n' '實作前先做設計審查。' ;;
    goldband-plan-eng-review:*) printf '%s\n' '實作前先做工程規劃審查。' ;;
    goldband-qa:*) printf '%s\n' '用真實瀏覽器做 QA 與驗證。' ;;
    goldband-qa-only:*) printf '%s\n' '只測不修，輸出 bug report。' ;;
    goldband-review:*) printf '%s\n' '針對目前 diff 做上線前審查。' ;;
    goldband-retro:*) printf '%s\n' '回顧近期輸出與改善方向。' ;;
    goldband-setup-browser-cookies:*) printf '%s\n' '匯入瀏覽器 cookies 供 QA 使用。' ;;
    goldband-setup-deploy:*) printf '%s\n' '設定 deploy 與 production 驗證資訊。' ;;
    goldband-ship:*) printf '%s\n' '發版與提 PR 流程。' ;;
    goldband-unfreeze:*) printf '%s\n' '解除 freeze 限制。' ;;
    *) return 1 ;;
  esac
}

rewrite_skill_description() {
  local skill_file="$1"
  local description="$2"
  local temp_desc
  temp_desc="$(mktemp)"
  printf '  %s\n' "$description" > "$temp_desc"

  awk -v desc_file="$temp_desc" '
    BEGIN {
      in_description = 0
      replaced = 0
    }
    replaced == 0 && $0 ~ /^description: [^|].*$/ {
      print "description: |"
      while ((getline line < desc_file) > 0) print line
      close(desc_file)
      replaced = 1
      next
    }
    replaced == 0 && $0 ~ /^description: \|$/ {
      print $0
      in_description = 1
      next
    }
    in_description == 1 {
      if ($0 ~ /^allowed-tools:/ || $0 ~ /^hooks:/ || $0 ~ /^---$/) {
        while ((getline line < desc_file) > 0) print line
        close(desc_file)
        print $0
        in_description = 0
        replaced = 1
        next
      }
      next
    }
    { print }
  ' "$skill_file" > "${skill_file}.tmp"

  mv "${skill_file}.tmp" "$skill_file"
  rm -f "$temp_desc"
}

sync_wrapper_descriptions() {
  local language="$1"
  local skill_file wrapper_name description

  for skill_file in "$HOME/.claude/skills"/goldband-*/SKILL.md "$HOME/.codex/skills"/goldband-*/SKILL.md; do
    [ -f "$skill_file" ] || continue
    wrapper_name="$(basename "$(dirname "$skill_file")")"
    description="$(wrapper_description "$wrapper_name" "$language" 2>/dev/null || true)"
    [ -n "$description" ] || continue
    rewrite_skill_description "$skill_file" "$description"
  done
}

main() {
  local mode="${1:-sync}"
  local requested="${2:-}"
  local workflow_config_bin
  local language

  workflow_config_bin="$(find_workflow_config_bin)" || {
    echo "workflow-config not found" >&2
    exit 1
  }

  case "$mode" in
    set)
      language="$(normalize_language "$requested")" || {
        echo "unsupported language: ${requested:-<empty>}" >&2
        exit 1
      }
      "$workflow_config_bin" set goldband_language "$language"
      ;;
    sync)
      if [ -n "$requested" ]; then
        language="$(normalize_language "$requested")" || {
          echo "unsupported language: $requested" >&2
          exit 1
        }
      else
        language="$(read_language "$workflow_config_bin")"
      fi
      ;;
    get)
      read_language "$workflow_config_bin"
      exit 0
      ;;
    *)
      echo "usage: $0 {set <zh-TW|en>|sync [zh-TW|en]|get}" >&2
      exit 1
      ;;
  esac

  if [ -z "${language:-}" ]; then
    language="$(read_language "$workflow_config_bin")"
  fi

  sync_wrapper_descriptions "$language"
  printf '%s\n' "$language"
}

main "$@"
