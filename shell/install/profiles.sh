# This file must be sourced by bash, not executed directly.

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
    install_shell_launchers
}

install_pack_quality() {
    install_skills_dev
    install_commands
    install_contexts
    install_rules
    install_hooks
    install_shell_launchers
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
    install_shell_launchers
}

install_codex_full() {
    install_codex_config
    install_codex_agents
    install_codex_rules
    install_codex_skills
    install_shell_launchers
}

install_all_tools() {
    install_skills
    install_commands
    install_contexts
    install_rules
    install_hooks
    install_shell_launchers
    install_codex_full
}

install_all_with_workflow() {
    install_all_tools
    install_workflow_host "auto"
}

install_commands() {
    link_component "$REPO_DIR/commands" "$CLAUDE_DIR/commands" "Commands (8 個)"
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

    local hooks_content
    hooks_content=$(jq --arg dir "$hooks_dir" '
        def expand_hook_paths:
            walk(if type == "string" then gsub("\\$\\{HOOKS_DIR\\}"; $dir) else . end);
        .hooks | expand_hook_paths
    ' "$hooks_json")

    if [ -z "$hooks_content" ] || [ "$hooks_content" = "null" ]; then
        echo -e "  ${RED}[錯誤] 無法讀取 hooks.json${NC}"
        return
    fi

    local permissions_content
    permissions_content=$(jq '.permissions // null' "$hooks_json")

    if [ ! -f "$settings_json" ]; then
        echo '{}' > "$settings_json"
    fi

    cp "$settings_json" "${settings_json}.bak"
    echo -e "  ${CYAN}[備份] settings.json -> settings.json.bak${NC}"

    local existing_hooks
    existing_hooks=$(jq '.hooks // {}' "$settings_json")

    local merged_hooks
    merged_hooks=$(jq -n \
        --argjson existing "$existing_hooks" \
        --argjson new_hooks "$hooks_content" \
        '
        def merge_phase(phase):
            (($existing[phase] // []) + ($new_hooks[phase] // []))
            | group_by(.hooks[0].command)
            | map(last);

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

    jq --argjson hooks "$merged_hooks" '.hooks = $hooks' "$settings_json" > "${settings_json}.tmp" \
        && mv "${settings_json}.tmp" "$settings_json"

    echo -e "  ${GREEN}[合併] Hooks 設定已自動合併到 settings.json${NC}"

    local statusline_content
    statusline_content=$(jq '.statusLine // null' "$hooks_json")
    if [ "$statusline_content" != "null" ] && [ -n "$statusline_content" ]; then
        local expanded_statusline
        expanded_statusline=$(jq -n --argjson statusline "$statusline_content" --arg dir "$CLAUDE_DIR" '
            $statusline | walk(if type == "string" then gsub("\\$\\{CLAUDE_DIR\\}"; $dir) else . end)
        ')
        jq --argjson sl "$expanded_statusline" '.statusLine = $sl' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[合併] statusLine 設定已自動合併到 settings.json${NC}"
    fi

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
    local project_dir
    project_dir="$(pwd)"
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
