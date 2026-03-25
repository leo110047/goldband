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
SKILLS_DIR="$CLAUDE_DIR/skills"
SKILL_PROFILE_FILE="$SKILLS_DIR/.goldband-profile"
CLAUDE_BIN_DIR="$CLAUDE_DIR/bin"
CLAUDE_SHELL_DIR="$CLAUDE_DIR/shell"
SHELL_UPDATE_BIN="$CLAUDE_BIN_DIR/goldband-self-update"
SHELL_LAUNCHERS_FILE="$CLAUDE_SHELL_DIR/goldband-launchers.sh"
ZSHRC_FILE="${ZDOTDIR:-$HOME}/.zshrc"
CODEX_DIR="$HOME/.codex"
CODEX_CONFIG_FILE="$CODEX_DIR/config.toml"
CODEX_AGENTS_FILE="$CODEX_DIR/AGENTS.md"
CODEX_RULES_DIR="$CODEX_DIR/rules"
CODEX_SKILLS_DIR="$HOME/.agents/skills"
CODEX_SKILL_PROFILE_FILE="$CODEX_SKILLS_DIR/.goldband-profile"
LEGACY_DEV_FLAG_USED=false

skill_catalog() {
    cat <<'EOF'
evidence-based-coding|core|core
systematic-debugging|core|core
file-search|core|core
planning-workflow|core|core
security-checklist|core|core
performance-optimization|core|core
api-design|dev|full
backend-patterns|dev|full
careful-mode|dev|
freeze-mode|dev|
claude-config-verification|dev|
code-review-skill|dev|full
database-patterns|dev|full
testing-strategy|dev|full
ci-cd-integration|full|full
commit-conventions|full|full
decision-log|full|full
new-skill-scaffold|full|
skill-developer|full|
subagent-development|full|full
EOF
}

show_help() {
    echo "用法: ./install.sh [選項]"
    echo ""
    echo "選項:"
    echo "  ----- Claude Code -----"
    echo "  pack-core   安裝核心包（預設，最小 token）"
    echo "  pack-quality 安裝品質開發包（core + commands/contexts）"
    echo "  pack-unity  安裝 Unity 包（quality + unity skills）"
    echo "  all         安裝所有組件（相容舊用法，等同 pack-quality）"
    echo "  all-full    安裝所有組件（skills 使用 full profile）"
    echo "  skills      安裝全域 skills（等同 skills-full）"
    echo "  skills-core 安裝核心常駐 skills（低 token）"
    echo "  skills-dev  安裝開發常用 skills（core + auto）"
    echo "  skills-full 安裝全部全域 skills（20 個）"
    echo "  commands    只安裝 commands"
    echo "  contexts    只安裝 contexts"
    echo "  rules       只安裝 rules"
    echo "  hooks       只安裝 hooks"
    echo "  launchers   安裝 shell 啟動整合（claude/codex 啟動前自動檢查更新）"
    echo "  unity       安裝 Unity 專案 skills 到當前目錄"
    echo "  ----- Codex -----"
    echo "  codex-core  安裝 Codex 核心設定（global AGENTS/config/rules + core skills）"
    echo "  codex-full  安裝 Codex 完整設定（global AGENTS/config/rules + portable skills）"
    echo "  codex       相容別名，等同 codex-full"
    echo "  codex-config 只安裝 ~/.codex/config.toml"
    echo "  codex-agents 只安裝 ~/.codex/AGENTS.md"
    echo "  codex-rules  只安裝 ~/.codex/rules"
    echo "  codex-skills 安裝 Codex portable skills 到 ~/.agents/skills"
    echo "  workflow      安裝內建 workflow 到 Claude Code"
    echo "  workflow-codex 安裝內建 workflow 到 Codex"
    echo "  workflow-auto 安裝 workflow 到自動偵測到的 host"
    echo "  all-tools   安裝 Claude all-full + Codex full"
    echo "  all-with-workflow 安裝 Claude + Codex 全組件，並安裝 workflow runtime"
    echo "  uninstall   移除所有安裝項目（含 profile links）"
    echo "  status      檢查安裝狀態"
    echo "  help        顯示此幫助"
    echo ""
    echo "範例:"
    echo "  ./install.sh              # 安裝 pack-core（預設）"
    echo "  ./install.sh pack-quality # 安裝品質開發包"
    echo "  ./install.sh all-full     # 安裝全部（full profile）"
    echo "  ./install.sh skills-dev rules # 安裝開發 profile + rules"
    echo "  ./install.sh skills-core  # 只裝核心 skills（建議日常）"
    echo "  ./install.sh skills-full  # 全量 skills"
    echo "  ./install.sh codex-full   # Codex 全量設定"
    echo "  ./install.sh workflow       # 安裝 workflow 到 Claude Code"
    echo "  ./install.sh workflow-codex # 安裝 workflow 到 Codex"
    echo "  WORKFLOW_REPO_DIR=../runtime ./install.sh all-with-workflow"
    echo "  ./install.sh all-tools    # Claude + Codex 全部安裝"
    echo "  ./install.sh unity        # 在 Unity 專案中安裝"
    echo "  ./install.sh status       # 檢查狀態"
}

load_install_modules() {
    local missing=0
    local install_module
    for install_module in \
        "$REPO_DIR/shell/install/common.sh" \
        "$REPO_DIR/shell/install/launchers.sh" \
        "$REPO_DIR/shell/install/workflow.sh" \
        "$REPO_DIR/shell/install/profiles.sh" \
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
        exit 0
        ;;
    uninstall)
        do_uninstall
        exit 0
        ;;
esac

for arg in "$@"; do
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
        pack-unity)
            echo -e "${GREEN}安裝 unity-pack...${NC}"
            echo ""
            install_pack_unity
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
            install_commands
            install_contexts
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
        commands)
            install_commands
            ;;
        contexts)
            install_contexts
            ;;
        rules)
            install_rules
            ;;
        hooks)
            install_hooks
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
        codex-agents)
            install_codex_agents
            ;;
        codex-rules)
            install_codex_rules
            ;;
        codex-skills)
            install_codex_skills
            ;;
        workflow)
            install_workflow_host "claude"
            ;;
        workflow-codex)
            install_workflow_host "codex"
            ;;
        workflow-auto)
            install_workflow_host "auto"
            ;;
        all-tools)
            echo -e "${GREEN}安裝 Claude + Codex 全組件...${NC}"
            echo ""
            install_all_tools
            ;;
        all-with-workflow)
            echo -e "${GREEN}安裝 Claude + Codex 全組件 + workflow...${NC}"
            echo ""
            install_all_with_workflow
            ;;
        unity)
            install_unity
            ;;
        *)
            echo -e "${RED}未知選項: $arg${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}安裝完成！${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}下一步：${NC}"
echo "  1. 重啟 Claude Code / Codex（若本次有安裝）"
echo "  2. 試試 /plan、/verify、/code-review、/discuss、/map-codebase、/verify-config 等命令"
echo "  3. 查看 ./install.sh status 確認安裝狀態"
echo ""
