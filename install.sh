#!/bin/bash

# goldband — 安裝腳本
# 用途：將 Claude Code 與 Codex 的設定安裝到使用者家目錄

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLAUDE_DIR="$HOME/.claude"
CLAUDE_GLOBAL_INSTRUCTIONS_FILE="$CLAUDE_DIR/CLAUDE.md"
SKILLS_DIR="$CLAUDE_DIR/skills"
SKILL_PROFILE_FILE="$SKILLS_DIR/.goldband-profile"
CLAUDE_BIN_DIR="$CLAUDE_DIR/bin"
CLAUDE_SHELL_DIR="$CLAUDE_DIR/shell"
SHELL_UPDATE_BIN="$CLAUDE_BIN_DIR/goldband-self-update"
SHELL_LAUNCHERS_FILE="$CLAUDE_SHELL_DIR/goldband-launchers.sh"
ZSHRC_FILE="${ZDOTDIR:-$HOME}/.zshrc"
CODEX_DIR="$HOME/.codex"
CODEX_CONFIG_FILE="$CODEX_DIR/config.toml"
if [ -z "${CODEX_REQUIREMENTS_FILE+x}" ]; then
    _goldband_uname="$(uname -s 2>/dev/null || true)"
    if [ "${GOLDBAND_TEST_WINDOWS_HOST:-0}" = "1" ]; then
        _goldband_uname="MINGW64_NT-test"
    fi
    case "$_goldband_uname" in
        MINGW*|MSYS*|CYGWIN*)
            _goldband_program_data="${ProgramData:-${PROGRAMDATA:-C:\\ProgramData}}"
            if command -v cygpath >/dev/null 2>&1; then
                CODEX_REQUIREMENTS_FILE="$(cygpath -u "$_goldband_program_data")/OpenAI/Codex/requirements.toml"
            elif [ "${_goldband_program_data#/}" != "$_goldband_program_data" ]; then
                CODEX_REQUIREMENTS_FILE="${_goldband_program_data%/}/OpenAI/Codex/requirements.toml"
            else
                CODEX_REQUIREMENTS_FILE="/c/ProgramData/OpenAI/Codex/requirements.toml"
            fi
            unset _goldband_program_data
            ;;
        *)
            CODEX_REQUIREMENTS_FILE="/etc/codex/requirements.toml"
            ;;
    esac
    unset _goldband_uname
fi
CODEX_AGENTS_FILE="$CODEX_DIR/AGENTS.md"
CODEX_CUSTOM_AGENTS_DIR="$CODEX_DIR/agents"
CODEX_PROMPTS_DIR="$CODEX_DIR/prompts"
CODEX_GOLDBAND_PROMPT_FILE="$CODEX_PROMPTS_DIR/goldband.md"
CODEX_HOOKS_FILE="$CODEX_DIR/hooks.json"
CODEX_HOOKS_DIR="$CODEX_DIR/hooks"
CODEX_REVIEW_RUNTIME_FILE="$CODEX_DIR/review-runtime/rules-resolver.js"
CODEX_RULES_DIR="$CODEX_DIR/rules"
CODEX_SKILLS_DIR="$HOME/.agents/skills"
CODEX_SKILL_PROFILE_FILE="$CODEX_SKILLS_DIR/.goldband-profile"
GIT_HOOKS_SOURCE_DIR="$REPO_DIR/git-hooks"
GIT_HOOKS_DIR="${GOLDBAND_GIT_HOOKS_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/goldband/git-hooks}"
LEGACY_GIT_HOOKS_DIR="$REPO_DIR/git-hooks"
SKILL_CATALOG_FILE="$REPO_DIR/shell/install/skill-catalog.txt"
LEGACY_DEV_FLAG_USED=false

skill_catalog() {
    cat "$SKILL_CATALOG_FILE"
}

show_help() {
    echo "用法: ./install.sh [選項]"
    echo ""
    echo "選項:"
    show_help_claude_options
    show_help_codex_options
    show_help_examples
}

show_help_claude_options() {
    echo "  ----- Claude Code -----"
    echo "  pack-core   安裝核心包（預設，最小 token）"
    echo "  pack-quality 安裝品質開發包（core + commands）"
    echo "  all         安裝所有組件（相容舊用法，等同 pack-quality）"
    echo "  all-full    安裝所有組件（skills 使用 full profile）"
    echo "  skills      安裝全域 skills（等同 skills-full）"
    echo "  skills-core 安裝核心常駐 skills（低 token）"
    echo "  skills-dev  安裝開發常用 skills（core + auto）"
    echo "  skills-full 安裝全部全域 skills（17 個）"
    echo "  claude-guidance 安裝 Claude 全域 CLAUDE.md"
    echo "  commands    只安裝 commands"
    echo "  rules       只安裝 rules"
    echo "  hooks       只安裝 hooks"
    echo "  claude-statusline 選配 Goldband Claude 狀態列（取代目前樣式）"
    echo "  style-gate  安裝全域 git style gate（pre-commit + commit-msg）"
    echo "  launchers   安裝 shell 啟動整合（claude/codex 啟動前自動檢查更新）"
}

show_help_codex_options() {
    echo "  ----- Codex -----"
    echo "  codex-core  安裝 Codex 核心設定（global AGENTS/config/rules + core skills）"
    echo "  codex-full  安裝 Codex 完整設定（global AGENTS/config/rules + portable skills）"
    echo "  codex       相容別名，等同 codex-full"
    echo "  codex-config 只安裝 ~/.codex/config.toml + profile config files"
    echo "  codex-statusline 選配 Goldband Codex 狀態列（取代目前樣式）"
    echo "  codex-requirements 安裝 Codex managed requirements（需要 /etc 寫入權限）"
    echo "  codex-agents 安裝 ~/.codex/AGENTS.md + ~/.codex/agents"
    echo "  codex-prompts 安裝 legacy ~/.codex/prompts/goldband.md fallback"
    echo "  codex-hooks  安裝 ~/.codex/hooks.json + ~/.codex/hooks"
    echo "  codex-rules  只安裝 ~/.codex/rules"
    echo "  repair-codex-rules 將本機 approvals 從 tracked rules 移到 ignored local overlay"
    echo "  codex-skills 安裝 Codex portable skills 到 ~/.agents/skills"
    echo "  workflow      安裝 Goldband Loop 到 Claude Code（standard profile）"
    echo "  workflow-codex 安裝 Goldband Loop 到 Codex（standard profile）"
    echo "  workflow-auto 安裝 Goldband Loop 到自動偵測到的 host（standard profile）"
    echo "  all-tools   安裝 Claude all-full + Codex full"
    echo "  all-with-workflow 安裝 Claude + Codex 全組件，並安裝 Goldband Loop"
    echo "  uninstall   移除所有安裝項目（含 profile links）"
    echo "  status      檢查安裝狀態"
    echo "  help        顯示此幫助"
    echo "  注意: MCP server 位於 mcp/server；installer 不會預設啟用"
}

show_help_examples() {
    echo ""
    echo "範例:"
    echo "  ./install.sh              # 安裝 pack-core（預設）"
    echo "  ./install.sh pack-quality # 安裝品質開發包"
    echo "  ./install.sh all-full     # 安裝全部（full profile）"
    echo "  ./install.sh skills-dev rules # 安裝開發 profile + rules"
    echo "  ./install.sh skills-core  # 只裝核心 skills（建議日常）"
    echo "  ./install.sh skills-full  # 全量 skills"
    echo "  ./install.sh codex-full   # Codex 全量設定"
    echo "  ./install.sh workflow       # 安裝 Goldband Loop 到 Claude Code（standard profile）"
    echo "  ./install.sh workflow-codex # 安裝 Goldband Loop 到 Codex（standard profile）"
    echo "  GOLDBAND_LOOP_DIR=../goldband-loop ./install.sh all-with-workflow"
    echo "  ./install.sh all-tools    # Claude + Codex 全部安裝"
    echo "  ./install.sh status       # 檢查狀態"
}

load_install_modules() {
    local missing=0
    local install_module
    for install_module in \
        "$REPO_DIR/shell/install/common.sh" \
        "$REPO_DIR/shell/install/install-state.sh" \
        "$REPO_DIR/shell/install/codex.sh" \
        "$REPO_DIR/shell/install/managed-profiles.sh" \
        "$REPO_DIR/shell/install/launchers.sh" \
        "$REPO_DIR/shell/install/workflow.sh" \
        "$REPO_DIR/shell/install/profiles.sh" \
        "$REPO_DIR/shell/install/app-support-status.sh" \
        "$REPO_DIR/shell/install/knowledge-status.sh" \
        "$REPO_DIR/shell/install/workflow-status.sh" \
        "$REPO_DIR/shell/install/status.sh" \
        "$REPO_DIR/shell/install/uninstall.sh"
    do
        if [ ! -f "$install_module" ]; then
            if [ "$missing" -eq 0 ]; then
                echo -e "${RED}goldband installer modules are missing.${NC}" >&2
                echo "請從完整 repo checkout 執行 install.sh，不要只複製單一檔案。" >&2
                echo "" >&2
            fi
            echo "  missing: $install_module" >&2
            missing=1
            continue
        fi
        # shellcheck source=/dev/null
        . "$install_module"
    done
    unset install_module

    [ "$missing" -eq 0 ]
}

load_install_modules || exit 1

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  goldband Installer${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}倉庫位置：${NC}$REPO_DIR"
echo ""

_filtered_args=()
for _arg in "$@"; do
    if [ "$_arg" = "--dev" ]; then
        LEGACY_DEV_FLAG_USED=true
    else
        _filtered_args+=("$_arg")
    fi
done
set -- "${_filtered_args[@]}"
unset _filtered_args _arg

if $LEGACY_DEV_FLAG_USED; then
    echo -e "${YELLOW}[提示] --dev 已無作用；goldband 現在預設使用 repo-linked 安裝${NC}"
    echo ""
fi

if [ $# -eq 0 ]; then
    set -- "pack-core"
fi

case "$1" in
    help|-h|--help)
        show_help
        exit 0
        ;;
    status)
        show_status
        exit $?
        ;;
    auto-refresh)
        run_auto_refresh "${GOLDBAND_AUTO_REFRESH_OLD_HEAD:-}" "${GOLDBAND_AUTO_REFRESH_NEW_HEAD:-}"
        exit $?
        ;;
    uninstall)
        do_uninstall
        clear_install_state
        exit 0
        ;;
esac

for arg in "$@"; do
    _record_arg="$arg"
    case "$arg" in
        pack-core)
            echo -e "${GREEN}安裝 core-security pack（預設）...${NC}"
            echo ""
            install_pack_core
            ;;
        pack-quality)
            echo -e "${GREEN}安裝 core-quality pack...${NC}"
            echo ""
            install_pack_quality
            ;;
        all)
            echo -e "${GREEN}安裝所有組件（相容舊用法，等同 pack-quality）...${NC}"
            echo ""
            install_pack_quality
            ;;
        all-full)
            echo -e "${GREEN}安裝所有組件（full profile）...${NC}"
            echo ""
            install_skills
            install_claude_guidance
            install_commands
            install_rules
            install_hooks
            install_shell_launchers
            ;;
        skills)
            install_skills
            ;;
        skills-core)
            install_skills_core
            ;;
        skills-dev)
            install_skills_dev
            ;;
        skills-full)
            install_skills
            ;;
        claude-guidance)
            install_claude_guidance
            ;;
        commands)
            install_commands
            ;;
        rules)
            install_rules
            ;;
        hooks)
            install_hooks
            ;;
        claude-statusline)
            install_claude_statusline
            ;;
        style-gate)
            install_style_gate
            ;;
        launchers)
            install_launchers
            ;;
        codex-core)
            echo -e "${GREEN}安裝 Codex core...${NC}"
            echo ""
            install_codex_core
            ;;
        codex-full|codex)
            echo -e "${GREEN}安裝 Codex full...${NC}"
            echo ""
            install_codex_full
            ;;
        codex-config)
            install_codex_config
            ;;
        codex-statusline)
            install_codex_statusline
            ;;
        codex-requirements)
            install_codex_requirements
            ;;
        codex-agents)
            install_codex_agents
            ;;
        codex-prompts)
            install_codex_prompts
            ;;
        codex-hooks)
            install_codex_hooks
            ;;
        codex-rules)
            install_codex_rules
            ;;
        repair-codex-rules|codex-repair)
            echo -e "${GREEN}修復 Codex local rules overlay...${NC}"
            echo ""
            repair_codex_local_rules
            ;;
        codex-skills)
            install_codex_skills
            ;;
        workflow)
            install_workflow_host "claude" "standard"
            ;;
        workflow-slim|workflow-full)
            echo -e "${YELLOW}$arg 已棄用；改用 workflow（standard profile）。${NC}" >&2
            install_workflow_host "claude" "standard"
            ;;
        workflow-codex)
            install_workflow_host "codex" "standard"
            ;;
        workflow-codex-slim|workflow-codex-full)
            echo -e "${YELLOW}$arg 已棄用；改用 workflow-codex（standard profile）。${NC}" >&2
            install_workflow_host "codex" "standard"
            ;;
        workflow-auto)
            install_workflow_host "auto" "standard"
            ;;
        workflow-auto-slim|workflow-auto-full)
            echo -e "${YELLOW}$arg 已棄用；改用 workflow-auto（standard profile）。${NC}" >&2
            install_workflow_host "auto" "standard"
            ;;
        all-tools)
            echo -e "${GREEN}安裝 Claude + Codex 全組件...${NC}"
            echo ""
            install_all_tools
            ;;
        all-with-workflow)
            echo -e "${GREEN}安裝 Claude + Codex 全組件 + Goldband Loop...${NC}"
            echo ""
            install_all_with_workflow
            ;;
        *)
            echo -e "${RED}未知選項: $arg${NC}"
            show_help
            exit 1
            ;;
    esac
    record_installed_target "$_record_arg"
done
unset _record_arg

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}安裝完成！${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}下一步：${NC}"
echo "  1. 重啟 Claude Code / Codex（若本次有安裝）"
echo "  2. 試試 Claude 的 /goldband，或 Codex 的 \$goldband review"
echo "  3. 查看 ./install.sh status 確認安裝狀態"
echo ""
