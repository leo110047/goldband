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

# Default: copy mode. Use --dev for symlink mode (when actively editing goldband itself).
LINK_MODE=false

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLAUDE_DIR="$HOME/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
SKILL_PROFILE_FILE="$SKILLS_DIR/.goldband-profile"
CODEX_DIR="$HOME/.codex"
CODEX_CONFIG_FILE="$CODEX_DIR/config.toml"
CODEX_AGENTS_FILE="$CODEX_DIR/AGENTS.md"
CODEX_RULES_DIR="$CODEX_DIR/rules"
CODEX_SKILLS_DIR="$HOME/.agents/skills"
CODEX_SKILL_PROFILE_FILE="$CODEX_SKILLS_DIR/.goldband-profile"

# Skill profile groups
CORE_SKILLS=(
    "evidence-based-coding"
    "systematic-debugging"
    "file-search"
    "planning-workflow"
    "security-checklist"
    "performance-optimization"
)

AUTO_SKILLS=(
    "api-design"
    "backend-patterns"
    "careful-mode"
    "freeze-mode"
    "claude-config-verification"
    "code-review-skill"
    "database-patterns"
    "testing-strategy"
)

ON_DEMAND_SKILLS=(
    "ci-cd-integration"
    "commit-conventions"
    "decision-log"
    "new-skill-scaffold"
    "skill-developer"
    "subagent-development"
)

CODEX_CORE_SKILLS=(
    "evidence-based-coding"
    "systematic-debugging"
    "file-search"
    "planning-workflow"
    "security-checklist"
    "performance-optimization"
)

CODEX_PORTABLE_SKILLS=(
    "api-design"
    "backend-patterns"
    "code-review-skill"
    "database-patterns"
    "testing-strategy"
    "ci-cd-integration"
    "commit-conventions"
    "decision-log"
    "subagent-development"
)

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

    if $LINK_MODE; then
        if [ -L "$dest" ]; then
            local current_target
            current_target=$(readlink "$dest")
            if [ "$current_target" = "$src" ]; then
                echo -e "  ${GREEN}[已安裝] $name${NC}"
                return
            fi
            rm "$dest"
        elif [ -e "$dest" ]; then
            echo -e "  ${YELLOW}[備份] $name — 備份現有到 ${dest}.bak${NC}"
            mv "$dest" "${dest}.bak"
        fi
        mkdir -p "$(dirname "$dest")"
        ln -s "$src" "$dest"
        echo -e "  ${GREEN}[安裝 (symlink)] $name${NC}"
    else
        if [ -L "$dest" ]; then
            rm "$dest"
        elif [ -e "$dest" ]; then
            rm -rf "$dest"
        fi
        mkdir -p "$(dirname "$dest")"
        cp -r "$src" "$dest"
        echo -e "  ${GREEN}[安裝] $name${NC}"
    fi
}

timestamp_suffix() {
    date +"%Y%m%d%H%M%S"
}

join_by_comma() {
    local IFS=","
    echo "$*"
}

dedupe_skill_list() {
    local seen=" "
    local output=()
    for skill in "$@"; do
        if [[ "$seen" != *" $skill "* ]]; then
            output+=("$skill")
            seen+=" $skill "
        fi
    done
    printf '%s\n' "${output[@]}"
}

build_skill_profile_list() {
    local profile="$1"
    case "$profile" in
        core)
            printf '%s\n' "${CORE_SKILLS[@]}"
            ;;
        dev)
            dedupe_skill_list "${CORE_SKILLS[@]}" "${AUTO_SKILLS[@]}"
            ;;
        full)
            dedupe_skill_list "${CORE_SKILLS[@]}" "${AUTO_SKILLS[@]}" "${ON_DEMAND_SKILLS[@]}"
            ;;
        *)
            return 1
            ;;
    esac
}

is_repo_skill_link_under() {
    local link_path="$1"
    local source_root="$2"
    if [ ! -L "$link_path" ]; then
        return 1
    fi
    local target
    target=$(readlink "$link_path")
    case "$target" in
        "$source_root"/*|"$source_root")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_repo_skill_link() {
    is_repo_skill_link_under "$1" "$REPO_DIR/skills/global"
}

backup_existing_path() {
    local path="$1"
    local backup_path="${path}.bak.$(timestamp_suffix)"
    mv "$path" "$backup_path"
    echo -e "  ${YELLOW}[備份] $(basename "$path") -> $backup_path${NC}"
}

prepare_skills_directory() {
    if [ -L "$SKILLS_DIR" ]; then
        local current_target
        current_target=$(readlink "$SKILLS_DIR")
        if [ "$current_target" = "$REPO_DIR/skills/global" ]; then
            rm "$SKILLS_DIR"
        else
            backup_existing_path "$SKILLS_DIR"
        fi
    elif [ -e "$SKILLS_DIR" ] && [ ! -d "$SKILLS_DIR" ]; then
        backup_existing_path "$SKILLS_DIR"
    fi

    mkdir -p "$SKILLS_DIR"
}

cleanup_managed_skill_links() {
    if [ ! -d "$SKILLS_DIR" ]; then
        return
    fi

    # Use profile file as source of truth (works for both copy and symlink installs)
    if [ -f "$SKILL_PROFILE_FILE" ]; then
        local skills_line
        skills_line=$(grep '^skills=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
        local skills_csv="${skills_line#skills=}"
        local skill
        IFS=',' read -r -a skill_array <<< "$skills_csv"
        for skill in "${skill_array[@]}"; do
            [ -z "$skill" ] && continue
            rm -rf "${SKILLS_DIR:?}/$skill"
        done
        rm -rf "$SKILLS_DIR/README.md" "$SKILLS_DIR/skill-rules.json"
    else
        # Fallback: legacy symlink detection
        local entry
        for entry in "$SKILLS_DIR"/* "$SKILLS_DIR"/.*; do
            if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
                continue
            fi
            local name
            name=$(basename "$entry")
            if [ "$name" = "." ] || [ "$name" = ".." ] || [ "$name" = ".goldband-profile" ]; then
                continue
            fi
            if is_repo_skill_link "$entry"; then
                rm "$entry"
            fi
        done
    fi

    rm -f "$SKILL_PROFILE_FILE"
}

link_skill_entry() {
    local source="$1"
    local dest="$2"

    if [ -L "$dest" ]; then
        rm "$dest"
    elif [ -e "$dest" ]; then
        backup_existing_path "$dest"
    fi

    if $LINK_MODE; then
        ln -s "$source" "$dest"
    else
        cp -r "$source" "$dest"
    fi
}

write_skill_profile_file() {
    local profile="$1"
    shift
    local skills_csv
    skills_csv=$(join_by_comma "$@")

    {
        echo "profile=$profile"
        echo "installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        echo "skills=$skills_csv"
    } > "$SKILL_PROFILE_FILE"
}

install_skills_profile() {
    local profile="$1"
    shift
    local selected_skills=("$@")

    prepare_skills_directory
    cleanup_managed_skill_links

    local installed=0
    local skill
    for skill in "${selected_skills[@]}"; do
        local src="$REPO_DIR/skills/global/$skill"
        local dest="$SKILLS_DIR/$skill"

        if [ ! -d "$src" ]; then
            echo -e "  ${YELLOW}[跳過] skill 不存在: $skill${NC}"
            continue
        fi

        link_skill_entry "$src" "$dest"
        installed=$((installed + 1))
    done

    link_skill_entry "$REPO_DIR/skills/global/README.md" "$SKILLS_DIR/README.md"
    link_skill_entry "$REPO_DIR/skills/global/skill-rules.json" "$SKILLS_DIR/skill-rules.json"

    write_skill_profile_file "$profile" "${selected_skills[@]}"

    echo -e "  ${GREEN}[安裝] 全域 Skills Profile: $profile (${installed} 個)${NC}"
}

build_codex_skill_profile_list() {
    local profile="$1"
    case "$profile" in
        core)
            printf '%s\n' "${CODEX_CORE_SKILLS[@]}"
            ;;
        full)
            dedupe_skill_list "${CODEX_CORE_SKILLS[@]}" "${CODEX_PORTABLE_SKILLS[@]}"
            ;;
        *)
            return 1
            ;;
    esac
}

prepare_codex_skills_directory() {
    if [ -L "$CODEX_SKILLS_DIR" ]; then
        backup_existing_path "$CODEX_SKILLS_DIR"
    elif [ -e "$CODEX_SKILLS_DIR" ] && [ ! -d "$CODEX_SKILLS_DIR" ]; then
        backup_existing_path "$CODEX_SKILLS_DIR"
    fi

    mkdir -p "$CODEX_SKILLS_DIR"
}

cleanup_managed_codex_skill_links() {
    if [ ! -d "$CODEX_SKILLS_DIR" ]; then
        return
    fi

    # Use profile file as source of truth (works for both copy and symlink installs)
    if [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
        local skills_line
        skills_line=$(grep '^skills=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
        local skills_csv="${skills_line#skills=}"
        local skill
        IFS=',' read -r -a skill_array <<< "$skills_csv"
        for skill in "${skill_array[@]}"; do
            [ -z "$skill" ] && continue
            rm -rf "${CODEX_SKILLS_DIR:?}/$skill"
        done
    else
        # Fallback: legacy symlink detection
        local entry
        for entry in "$CODEX_SKILLS_DIR"/* "$CODEX_SKILLS_DIR"/.*; do
            if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
                continue
            fi
            local name
            name=$(basename "$entry")
            if [ "$name" = "." ] || [ "$name" = ".." ] || [ "$name" = ".goldband-profile" ]; then
                continue
            fi
            if is_repo_skill_link "$entry"; then
                rm "$entry"
            fi
        done
    fi

    rm -f "$CODEX_SKILL_PROFILE_FILE"
}

write_codex_skill_profile_file() {
    local profile="$1"
    shift
    local skills_csv
    skills_csv=$(join_by_comma "$@")

    {
        echo "profile=$profile"
        echo "installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        echo "skills=$skills_csv"
    } > "$CODEX_SKILL_PROFILE_FILE"
}

install_codex_skills_profile() {
    local profile="$1"
    shift
    local selected_skills=("$@")

    prepare_codex_skills_directory
    cleanup_managed_codex_skill_links

    local installed=0
    local skill
    for skill in "${selected_skills[@]}"; do
        local src="$REPO_DIR/skills/global/$skill"
        local dest="$CODEX_SKILLS_DIR/$skill"

        if [ ! -d "$src" ]; then
            echo -e "  ${YELLOW}[跳過] Codex skill 不存在: $skill${NC}"
            continue
        fi

        link_skill_entry "$src" "$dest"
        installed=$((installed + 1))
    done

    write_codex_skill_profile_file "$profile" "${selected_skills[@]}"

    echo -e "  ${GREEN}[安裝] Codex Skills Profile: $profile (${installed} 個)${NC}"
}

resolve_gstack_repo_dir() {
    local candidates=()

    if [ -n "${GSTACK_REPO_DIR:-}" ]; then
        candidates+=("$GSTACK_REPO_DIR")
    fi

    candidates+=(
        "$REPO_DIR/vendor/gstack"
        "$HOME/.claude/skills/gstack"
        "$HOME/.codex/skills/gstack"
        "$HOME/gstack"
        "$REPO_DIR/../gstack"
    )

    local candidate
    for candidate in "${candidates[@]}"; do
        [ -n "$candidate" ] || continue
        if [ -f "$candidate/setup" ]; then
            local resolved
            resolved="$(cd "$candidate" 2>/dev/null && pwd -P)" || continue
            echo "$resolved"
            return 0
        fi
    done

    return 1
}

read_gstack_version() {
    local repo_dir="$1"
    if [ -f "$repo_dir/VERSION" ]; then
        tr -d '\n' < "$repo_dir/VERSION"
        return 0
    fi
    return 1
}

install_gstack_host() {
    local host="$1"
    local repo_dir

    if ! repo_dir="$(resolve_gstack_repo_dir)"; then
        echo -e "${RED}找不到 gstack repo。${NC}"
        echo -e "  可設定 ${CYAN}GSTACK_REPO_DIR=/path/to/gstack${NC} 後重試"
        echo -e "  預設會先找 repo 內建的 ${CYAN}$REPO_DIR/vendor/gstack${NC}"
        exit 1
    fi

    local version="unknown"
    version="$(read_gstack_version "$repo_dir" 2>/dev/null || echo "unknown")"
    echo -e "${GREEN}安裝 gstack (${host})...${NC}"
    echo -e "  repo: ${CYAN}$repo_dir${NC}"
    echo -e "  version: ${CYAN}$version${NC}"
    echo ""
    (
        cd "$repo_dir" || {
            echo "  [錯誤] 無法進入 gstack repo: $repo_dir"
            exit 1
        }
        ./setup --host "$host"
    )
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
    echo "  unity       安裝 Unity 專案 skills 到當前目錄"
    echo "  ----- Codex -----"
    echo "  codex-core  安裝 Codex 核心設定（global AGENTS/config/rules + core skills）"
    echo "  codex-full  安裝 Codex 完整設定（global AGENTS/config/rules + portable skills）"
    echo "  codex       相容別名，等同 codex-full"
    echo "  codex-config 只安裝 ~/.codex/config.toml"
    echo "  codex-agents 只安裝 ~/.codex/AGENTS.md"
    echo "  codex-rules  只安裝 ~/.codex/rules"
    echo "  codex-skills 安裝 Codex portable skills 到 ~/.agents/skills"
    echo "  gstack      安裝 gstack 到 Claude Code（薄封裝，呼叫 gstack ./setup --host claude）"
    echo "  gstack-codex 安裝 gstack 到 Codex（薄封裝，呼叫 gstack ./setup --host codex）"
    echo "  gstack-auto 安裝 gstack 到自動偵測到的 host"
    echo "  all-tools   安裝 Claude all-full + Codex full"
    echo "  all-with-gstack 安裝 Claude + Codex 全組件，並呼叫 gstack ./setup --host auto"
    echo "  uninstall   移除所有安裝項目（含 profile links）"
    echo "  status      檢查安裝狀態"
    echo "  help        顯示此幫助"
    echo ""
    echo "Flag:"
    echo "  --dev       symlink 模式（預設為複製）"
    echo "              適合正在修改 goldband 本身時使用"
    echo ""
    echo "範例:"
    echo "  ./install.sh              # 安裝 pack-core（預設）"
    echo "  ./install.sh pack-quality # 安裝品質開發包"
    echo "  ./install.sh all-full     # 安裝全部（full profile）"
    echo "  ./install.sh skills-dev rules # 安裝開發 profile + rules"
    echo "  ./install.sh skills-core  # 只裝核心 skills（建議日常）"
    echo "  ./install.sh skills-full  # 全量 skills"
    echo "  ./install.sh codex-full   # Codex 全量設定"
    echo "  ./install.sh gstack       # 安裝 gstack 到 Claude Code"
    echo "  ./install.sh gstack-codex # 安裝 gstack 到 Codex"
    echo "  GSTACK_REPO_DIR=../gstack ./install.sh all-with-gstack"
    echo "  ./install.sh all-tools    # Claude + Codex 全部安裝"
    echo "  ./install.sh unity        # 在 Unity 專案中安裝"
    echo "  ./install.sh status       # 檢查狀態"
}

install_skills() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_skill_profile_list "full")
    install_skills_profile "full" "${skill_list[@]}"
}

install_skills_core() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_skill_profile_list "core")
    install_skills_profile "core" "${skill_list[@]}"
}

install_skills_dev() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_skill_profile_list "dev")
    install_skills_profile "dev" "${skill_list[@]}"
}

install_pack_core() {
    install_skills_core
    install_rules
    install_hooks
}

install_pack_quality() {
    install_skills_dev
    install_commands
    install_contexts
    install_rules
    install_hooks
}

install_pack_unity() {
    install_pack_quality
    install_unity
}

install_codex_skills() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_codex_skill_profile_list "full")
    install_codex_skills_profile "full" "${skill_list[@]}"
}

install_codex_skills_core() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_codex_skill_profile_list "core")
    install_codex_skills_profile "core" "${skill_list[@]}"
}

install_codex_config() {
    link_component "$REPO_DIR/codex/config.toml" "$CODEX_CONFIG_FILE" "Codex config.toml"
}

install_codex_agents() {
    link_component "$REPO_DIR/codex/AGENTS.md" "$CODEX_AGENTS_FILE" "Codex AGENTS.md"
}

install_codex_rules() {
    link_component "$REPO_DIR/codex/rules" "$CODEX_RULES_DIR" "Codex Rules"
}

install_codex_core() {
    install_codex_config
    install_codex_agents
    install_codex_rules
    install_codex_skills_core
}

install_codex_full() {
    install_codex_config
    install_codex_agents
    install_codex_rules
    install_codex_skills
}

install_all_tools() {
    install_skills
    install_commands
    install_contexts
    install_rules
    install_hooks
    install_codex_full
}

install_all_with_gstack() {
    install_all_tools
    install_gstack_host "auto"
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
            UserPromptSubmit: merge_phase("UserPromptSubmit"),
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

    # Merge statusLine if present
    local statusline_content
    statusline_content=$(jq '.statusLine // null' "$hooks_json")
    if [ "$statusline_content" != "null" ] && [ -n "$statusline_content" ]; then
        local expanded_statusline
        expanded_statusline=$(echo "$statusline_content" | sed "s|\\\${CLAUDE_DIR}|$CLAUDE_DIR|g")
        jq --argjson sl "$expanded_statusline" '.statusLine = $sl' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[合併] statusLine 設定已自動合併到 settings.json${NC}"
    fi

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
    link_component "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts" "Hook Scripts"
    link_component "$REPO_DIR/hooks/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh" "Status Line Script"
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
    link_component "$REPO_DIR/skills/projects/unity" "$project_dir/.claude/skills" "Unity Skills (10 個)"
}

show_status() {
    echo -e "${BLUE}安裝狀態檢查${NC}"
    echo ""

    if [ -L "$SKILLS_DIR" ]; then
        local skills_target
        skills_target=$(readlink "$SKILLS_DIR")
        echo -e "  ${GREEN}[OK]${NC} skills (legacy symlink) -> $skills_target"
    elif [ -d "$SKILLS_DIR" ]; then
        if [ -f "$SKILL_PROFILE_FILE" ]; then
            local profile_line
            profile_line=$(grep '^profile=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
            local profile="${profile_line#profile=}"
            local skills_line
            skills_line=$(grep '^skills=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
            local skills_csv="${skills_line#skills=}"
            local skill_count=0
            if [ -n "$skills_csv" ]; then
                skill_count=$(echo "$skills_csv" | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')
            fi
            echo -e "  ${GREEN}[OK]${NC} skills profile: ${profile:-unknown} (${skill_count} 個)"
        else
            echo -e "  ${YELLOW}[存在]${NC} skills 目錄存在，但不是 goldband profile 管理模式"
        fi
    else
        echo -e "  ${RED}[未安裝]${NC} skills"
    fi

    local components=("commands:$CLAUDE_DIR/commands" "contexts:$CLAUDE_DIR/contexts" "rules:$CLAUDE_DIR/rules" "hooks:$CLAUDE_DIR/hooks/scripts" "statusline:$CLAUDE_DIR/statusline-command.sh")

    for item in "${components[@]}"; do
        local name="${item%%:*}"
        local path="${item##*:}"

        if [ -L "$path" ]; then
            local target
            target=$(readlink "$path")
            echo -e "  ${GREEN}[OK]${NC} $name -> $target"
        elif [ -e "$path" ]; then
            echo -e "  ${GREEN}[OK]${NC} $name"
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

    echo ""
    echo -e "${BLUE}Codex 狀態${NC}"

    local codex_components=("codex-config:$CODEX_CONFIG_FILE" "codex-agents:$CODEX_AGENTS_FILE" "codex-rules:$CODEX_RULES_DIR")

    for item in "${codex_components[@]}"; do
        local name="${item%%:*}"
        local path="${item##*:}"

        if [ -L "$path" ]; then
            local target
            target=$(readlink "$path")
            echo -e "  ${GREEN}[OK]${NC} $name -> $target"
        elif [ -e "$path" ]; then
            echo -e "  ${GREEN}[OK]${NC} $name"
        else
            echo -e "  ${RED}[未安裝]${NC} $name"
        fi
    done

    if [ -d "$CODEX_SKILLS_DIR" ]; then
        if [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
            local profile_line
            profile_line=$(grep '^profile=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
            local profile="${profile_line#profile=}"
            local skills_line
            skills_line=$(grep '^skills=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
            local skills_csv="${skills_line#skills=}"
            local skill_count=0
            if [ -n "$skills_csv" ]; then
                skill_count=$(echo "$skills_csv" | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')
            fi
            echo -e "  ${GREEN}[OK]${NC} codex skills profile: ${profile:-unknown} (${skill_count} 個)"
        else
            echo -e "  ${YELLOW}[存在]${NC} codex skills 目錄存在，但不是 goldband profile 管理模式"
        fi
    else
        echo -e "  ${RED}[未安裝]${NC} codex skills"
    fi

    echo ""
    echo -e "${BLUE}gstack 狀態${NC}"

    local gstack_claude_dir="$HOME/.claude/skills/gstack"
    local gstack_codex_dir="$HOME/.codex/skills/gstack"
    local gstack_version

    if [ -d "$gstack_claude_dir" ]; then
        gstack_version="$(read_gstack_version "$gstack_claude_dir" 2>/dev/null || echo "unknown")"
        echo -e "  ${GREEN}[OK]${NC} gstack Claude install (${gstack_version})"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} gstack Claude install"
    fi

    if [ -d "$gstack_codex_dir" ]; then
        gstack_version="$(read_gstack_version "$gstack_codex_dir" 2>/dev/null || echo "unknown")"
        echo -e "  ${GREEN}[OK]${NC} gstack Codex runtime (${gstack_version})"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} gstack Codex runtime"
    fi

    if [ -d "$gstack_codex_dir" ]; then
        local generated_count
        generated_count=$(find "$HOME/.codex/skills" -maxdepth 1 -type l -name 'gstack-*' 2>/dev/null | wc -l | tr -d ' ')
        echo -e "  ${GREEN}[OK]${NC} gstack Codex generated skills: ${generated_count:-0}"
    fi
}

do_uninstall() {
    echo -e "${YELLOW}移除安裝...${NC}"
    if [ -L "$SKILLS_DIR" ]; then
        rm "$SKILLS_DIR"
        echo -e "  ${GREEN}[移除] $SKILLS_DIR${NC}"
    elif [ -d "$SKILLS_DIR" ] && [ -f "$SKILL_PROFILE_FILE" ]; then
        local skills_line
        skills_line=$(grep '^skills=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
        local skills_csv="${skills_line#skills=}"
        local skill
        IFS=',' read -r -a skill_array <<< "$skills_csv"
        for skill in "${skill_array[@]}"; do
            [ -z "$skill" ] && continue
            rm -rf "${SKILLS_DIR:?}/$skill"
        done
        rm -rf "$SKILLS_DIR/README.md" "$SKILLS_DIR/skill-rules.json"
        rm -f "$SKILL_PROFILE_FILE"
        if [ -z "$(ls -A "$SKILLS_DIR" 2>/dev/null)" ]; then
            rmdir "$SKILLS_DIR"
        fi
        echo -e "  ${GREEN}[移除] skills${NC}"
    fi

    local paths=("$CLAUDE_DIR/commands" "$CLAUDE_DIR/contexts" "$CLAUDE_DIR/rules" "$CLAUDE_DIR/hooks/scripts")

    for p in "${paths[@]}"; do
        if [ -L "$p" ]; then
            rm "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        elif [ -e "$p" ]; then
            rm -rf "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        fi
    done

    # Remove statusline script (symlink or copy)
    if [ -L "$CLAUDE_DIR/statusline-command.sh" ]; then
        rm "$CLAUDE_DIR/statusline-command.sh"
        echo -e "  ${GREEN}[移除] statusline-command.sh${NC}"
    elif [ -f "$CLAUDE_DIR/statusline-command.sh" ]; then
        rm "$CLAUDE_DIR/statusline-command.sh"
        echo -e "  ${GREEN}[移除] statusline-command.sh${NC}"
    fi

    # Clean up hooks and statusLine from settings.json
    local settings_json="$CLAUDE_DIR/settings.json"
    if [ -f "$settings_json" ] && command -v jq &> /dev/null; then
        cp "$settings_json" "${settings_json}.bak"
        jq 'del(.hooks) | del(.statusLine)' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[移除] settings.json 中的 hooks/statusLine 設定（已備份為 .bak）${NC}"
    fi

    if [ -d "$CODEX_SKILLS_DIR" ] && [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
        local skills_line
        skills_line=$(grep '^skills=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
        local skills_csv="${skills_line#skills=}"
        local skill
        IFS=',' read -r -a skill_array <<< "$skills_csv"
        for skill in "${skill_array[@]}"; do
            [ -z "$skill" ] && continue
            rm -rf "${CODEX_SKILLS_DIR:?}/$skill"
        done
        rm -f "$CODEX_SKILL_PROFILE_FILE"
        if [ -z "$(ls -A "$CODEX_SKILLS_DIR" 2>/dev/null)" ]; then
            rmdir "$CODEX_SKILLS_DIR"
        fi
        echo -e "  ${GREEN}[移除] Codex skills${NC}"
    fi

    local codex_paths=("$CODEX_CONFIG_FILE" "$CODEX_AGENTS_FILE" "$CODEX_RULES_DIR")

    for p in "${codex_paths[@]}"; do
        if [ -L "$p" ]; then
            rm "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        elif [ -e "$p" ]; then
            rm -rf "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        fi
    done

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

# Parse --dev flag (symlink mode)
_filtered_args=()
for _arg in "$@"; do
    if [ "$_arg" = "--dev" ]; then
        LINK_MODE=true
    else
        _filtered_args+=("$_arg")
    fi
done
set -- "${_filtered_args[@]}"
unset _filtered_args _arg

if $LINK_MODE; then
    echo -e "${CYAN}模式：symlink (--dev)${NC}"
    echo ""
fi

# 無參數 = 安裝核心包
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
        gstack)
            install_gstack_host "claude"
            ;;
        gstack-codex)
            install_gstack_host "codex"
            ;;
        gstack-auto)
            install_gstack_host "auto"
            ;;
        all-tools)
            echo -e "${GREEN}安裝 Claude + Codex 全組件...${NC}"
            echo ""
            install_all_tools
            ;;
        all-with-gstack)
            echo -e "${GREEN}安裝 Claude + Codex 全組件 + gstack...${NC}"
            echo ""
            install_all_with_gstack
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
