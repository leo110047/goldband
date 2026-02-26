#!/bin/bash

# goldband — 安裝腳本
# 用途：將 skills、commands、contexts、rules、hooks 安裝到 ~/.claude/

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLAUDE_DIR="$HOME/.claude"

# ─────────────────────────────────────
# 工具函數
# ─────────────────────────────────────

link_component() {
    local src="$1"
    local dest="$2"
    local name="$3"

    if [ ! -e "$src" ]; then
        echo -e "  ${YELLOW}[跳過] $name — 來源不存在${NC}"
        return
    fi

    if [ -L "$dest" ]; then
        local current_target
        current_target=$(readlink "$dest")
        if [ "$current_target" = "$src" ]; then
            echo -e "  ${GREEN}[已安裝] $name${NC}"
            return
        fi
        rm "$dest"
    elif [ -e "$dest" ]; then
        echo -e "  ${YELLOW}[備份] $name — 備份現有檔案到 ${dest}.bak${NC}"
        mv "$dest" "${dest}.bak"
    fi

    mkdir -p "$(dirname "$dest")"
    ln -s "$src" "$dest"
    echo -e "  ${GREEN}[安裝] $name${NC}"
}

show_help() {
    echo "用法: ./install.sh [選項]"
    echo ""
    echo "選項:"
    echo "  all         安裝所有組件（預設）"
    echo "  skills      只安裝全域 skills"
    echo "  commands    只安裝 commands"
    echo "  contexts    只安裝 contexts"
    echo "  rules       只安裝 rules"
    echo "  hooks       只安裝 hooks"
    echo "  unity       安裝 Unity 專案 skills 到當前目錄"
    echo "  uninstall   移除所有 symlinks"
    echo "  status      檢查安裝狀態"
    echo "  help        顯示此幫助"
    echo ""
    echo "範例:"
    echo "  ./install.sh              # 安裝全部"
    echo "  ./install.sh skills rules # 只安裝 skills 和 rules"
    echo "  ./install.sh unity        # 在 Unity 專案中安裝"
    echo "  ./install.sh status       # 檢查狀態"
}

install_skills() {
    link_component "$REPO_DIR/skills/global" "$CLAUDE_DIR/skills" "全域 Skills (16 個)"
}

install_commands() {
    link_component "$REPO_DIR/commands" "$CLAUDE_DIR/commands" "Commands (7 個)"
}

install_contexts() {
    link_component "$REPO_DIR/contexts" "$CLAUDE_DIR/contexts" "Contexts (4 個)"
}

install_rules() {
    link_component "$REPO_DIR/rules" "$CLAUDE_DIR/rules" "Rules (3 個)"
}

merge_hooks_config() {
    local hooks_json="$REPO_DIR/hooks/hooks.json"
    local settings_json="$CLAUDE_DIR/settings.json"
    local hooks_dir="$CLAUDE_DIR/hooks"

    if ! command -v jq &> /dev/null; then
        echo -e "  ${YELLOW}[提示] jq 未安裝，無法自動合併 hooks 設定${NC}"
        echo -e "  ${CYAN}  請手動操作:${NC}"
        echo -e "  ${CYAN}  1. 將 hooks/hooks.json 的內容合併到 ~/.claude/settings.json${NC}"
        echo -e "  ${CYAN}  2. 將路徑中的 \${HOOKS_DIR} 替換為:${NC}"
        echo -e "  ${CYAN}     $hooks_dir${NC}"
        echo -e "  ${CYAN}  或安裝 jq 後重新執行: brew install jq${NC}"
        return
    fi

    # Read hooks from hooks.json and replace ${HOOKS_DIR} with actual path
    local hooks_content
    hooks_content=$(jq '.hooks' "$hooks_json" | sed "s|\\\${HOOKS_DIR}|$hooks_dir|g")

    if [ -z "$hooks_content" ] || [ "$hooks_content" = "null" ]; then
        echo -e "  ${RED}[錯誤] 無法讀取 hooks.json${NC}"
        return
    fi

    # Read permissions from hooks.json
    local permissions_content
    permissions_content=$(jq '.permissions // null' "$hooks_json")

    # Initialize settings.json if it doesn't exist
    if [ ! -f "$settings_json" ]; then
        echo '{}' > "$settings_json"
    fi

    # Backup existing settings
    cp "$settings_json" "${settings_json}.bak"
    echo -e "  ${CYAN}[備份] settings.json -> settings.json.bak${NC}"

    # Read existing hooks from settings.json
    local existing_hooks
    existing_hooks=$(jq '.hooks // {}' "$settings_json")

    # Merge hooks by deduplicating on command field within each phase
    local merged_hooks
    merged_hooks=$(jq -n \
        --argjson existing "$existing_hooks" \
        --argjson new_hooks "$hooks_content" \
        '
        # For each phase, merge arrays by command dedup
        def merge_phase(phase):
            (($existing[phase] // []) + ($new_hooks[phase] // []))
            | group_by(.hooks[0].command)
            | map(last);

        # For prompt-based hooks (no command field), dedup by description
        def merge_by_description(phase):
            (($existing[phase] // []) + ($new_hooks[phase] // []))
            | group_by(.description)
            | map(last);

        {
            PreToolUse: merge_phase("PreToolUse"),
            PostToolUse: merge_phase("PostToolUse"),
            Stop: merge_phase("Stop"),
            SubagentStop: merge_by_description("SubagentStop"),
            Notification: merge_by_description("Notification")
        }
        ')

    # Write merged hooks back to settings.json
    jq --argjson hooks "$merged_hooks" '.hooks = $hooks' "$settings_json" > "${settings_json}.tmp" \
        && mv "${settings_json}.tmp" "$settings_json"

    echo -e "  ${GREEN}[合併] Hooks 設定已自動合併到 settings.json${NC}"

    # Merge permissions if present (merge allow/deny arrays, don't overwrite)
    if [ "$permissions_content" != "null" ] && [ -n "$permissions_content" ]; then
        jq --argjson new_perms "$permissions_content" '
            .permissions.defaultMode = ($new_perms.defaultMode // .permissions.defaultMode // "default") |
            .permissions.allow = ((.permissions.allow // []) + ($new_perms.allow // []) | unique) |
            .permissions.deny = ((.permissions.deny // []) + ($new_perms.deny // []) | unique)
        ' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[合併] Permissions 設定已自動合併到 settings.json${NC}"
    fi
}

install_hooks() {
    link_component "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts" "Hook Scripts (10 個)"
    echo ""
    merge_hooks_config
}

install_unity() {
    local project_dir="$(pwd)"
    if [ ! -d "Assets" ]; then
        echo -e "${YELLOW}警告：當前目錄不像是 Unity 專案（沒有 Assets 資料夾）${NC}"
        read -p "是否繼續？(y/n): " cont
        if [ "$cont" != "y" ]; then
            echo -e "${RED}安裝取消${NC}"
            return
        fi
    fi
    mkdir -p "$project_dir/.claude"
    link_component "$REPO_DIR/skills/projects/unity" "$project_dir/.claude/skills" "Unity Skills (5 個)"
}

show_status() {
    echo -e "${BLUE}安裝狀態檢查${NC}"
    echo ""

    local components=("skills:$CLAUDE_DIR/skills" "commands:$CLAUDE_DIR/commands" "contexts:$CLAUDE_DIR/contexts" "rules:$CLAUDE_DIR/rules" "hooks:$CLAUDE_DIR/hooks/scripts")

    for item in "${components[@]}"; do
        local name="${item%%:*}"
        local path="${item##*:}"

        if [ -L "$path" ]; then
            local target
            target=$(readlink "$path")
            echo -e "  ${GREEN}[OK]${NC} $name -> $target"
        elif [ -e "$path" ]; then
            echo -e "  ${YELLOW}[存在但非 symlink]${NC} $name: $path"
        else
            echo -e "  ${RED}[未安裝]${NC} $name"
        fi
    done

    # Check hooks in settings.json
    echo ""
    local settings_json="$CLAUDE_DIR/settings.json"
    if [ -f "$settings_json" ] && command -v jq &> /dev/null; then
        local hook_count
        hook_count=$(jq '[.hooks // {} | to_entries[] | .value | length] | add // 0' "$settings_json" 2>/dev/null)
        if [ "$hook_count" -gt 0 ] 2>/dev/null; then
            echo -e "  ${GREEN}[OK]${NC} hooks in settings.json ($hook_count 個 hook 已設定)"
        else
            echo -e "  ${YELLOW}[未設定]${NC} hooks in settings.json — 執行 ./install.sh hooks 來設定"
        fi
    elif [ -f "$settings_json" ]; then
        echo -e "  ${YELLOW}[需要 jq]${NC} 無法檢查 settings.json 中的 hooks 設定"
    else
        echo -e "  ${RED}[未安裝]${NC} settings.json 不存在"
    fi
}

do_uninstall() {
    echo -e "${YELLOW}移除安裝...${NC}"
    local paths=("$CLAUDE_DIR/skills" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/contexts" "$CLAUDE_DIR/rules" "$CLAUDE_DIR/hooks/scripts")

    for p in "${paths[@]}"; do
        if [ -L "$p" ]; then
            rm "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        fi
    done

    # Clean up hooks from settings.json
    local settings_json="$CLAUDE_DIR/settings.json"
    if [ -f "$settings_json" ] && command -v jq &> /dev/null; then
        cp "$settings_json" "${settings_json}.bak"
        jq 'del(.hooks)' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[移除] settings.json 中的 hooks 設定（已備份為 .bak）${NC}"
    fi

    echo -e "${GREEN}完成${NC}"
}

# ─────────────────────────────────────
# 主程式
# ─────────────────────────────────────

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  goldband Installer${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}倉庫位置：${NC}$REPO_DIR"
echo ""

# 無參數 = 安裝全部
if [ $# -eq 0 ]; then
    set -- "all"
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

mkdir -p "$CLAUDE_DIR"

for arg in "$@"; do
    case "$arg" in
        all)
            echo -e "${GREEN}安裝所有組件...${NC}"
            echo ""
            install_skills
            install_commands
            install_contexts
            install_rules
            install_hooks
            ;;
        skills)
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
echo "  1. 重啟 Claude Code"
echo "  2. 試試 /plan、/verify、/code-review、/discuss、/map-codebase、/verify-config 等命令"
echo "  3. 查看 ./install.sh status 確認安裝狀態"
echo ""
