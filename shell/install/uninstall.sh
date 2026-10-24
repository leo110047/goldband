# This file must be sourced by bash, not executed directly.

do_uninstall() {
    local result=0
    echo -e "${YELLOW}移除安裝...${NC}"
    uninstall_claude_skills
    uninstall_claude_guidance
    if uninstall_claude_settings; then
        uninstall_claude_paths
    else
        echo "[錯誤] Claude settings were preserved; keeping Claude assets referenced by them." >&2
        result=1
    fi
    uninstall_codex_skills
    uninstall_codex_prompt
    uninstall_codex_paths
    uninstall_codex_requirements
    uninstall_style_gate
    if [ "$result" -eq 0 ]; then echo -e "${GREEN}完成${NC}"; fi
    return "$result"
}

uninstall_claude_skills() {
    if [ -L "$SKILLS_DIR" ]; then
        rm "$SKILLS_DIR"
        echo -e "  ${GREEN}[移除] $SKILLS_DIR${NC}"
    elif [ -d "$SKILLS_DIR" ] && [ -f "$SKILL_PROFILE_FILE" ]; then
        remove_profile_skills "$SKILLS_DIR" "$SKILL_PROFILE_FILE"
        rm -rf "$SKILLS_DIR/README.md" "$SKILLS_DIR/skill-rules.json"
        remove_empty_dir "$SKILLS_DIR"
        echo -e "  ${GREEN}[移除] skills${NC}"
    fi
}

remove_profile_skills() {
    local skills_dir="$1"
    local profile_file="$2"
    local skills_line skills_csv skill
    local skill_array=()
    skills_line=$(grep '^skills=' "$profile_file" 2>/dev/null || true)
    skills_csv="${skills_line#skills=}"
    read_profile_skill_array "$skills_csv" skill_array
    for skill in "${skill_array[@]}"; do
        remove_repo_component "$REPO_DIR/skills/global/$skill" "${skills_dir:?}/$skill"
    done
    rm -f "$profile_file"
}

remove_empty_dir() {
    local dir="$1"
    if [ -d "$dir" ] && [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
        rmdir "$dir"
    fi
}

uninstall_claude_guidance() {
    local src="$REPO_DIR/claude/CLAUDE.md"
    if [ -L "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE" ]; then
        local target
        target=$(readlink "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE")
        if [ "$target" = "$src" ]; then
            rm "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE"
            echo -e "  ${GREEN}[移除] $CLAUDE_GLOBAL_INSTRUCTIONS_FILE${NC}"
        else
            echo -e "  ${YELLOW}[保留] Claude CLAUDE.md — 不是 goldband 管理的連結: $CLAUDE_GLOBAL_INSTRUCTIONS_FILE${NC}"
        fi
    elif [ -e "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE" ]; then
        echo -e "  ${YELLOW}[保留] Claude CLAUDE.md — 不是 goldband 管理的連結: $CLAUDE_GLOBAL_INSTRUCTIONS_FILE${NC}"
    fi
}

uninstall_claude_paths() {
    retire_claude_rule_autoload
    remove_repo_component "$REPO_DIR/commands" "$CLAUDE_DIR/commands"
    remove_repo_component "$REPO_DIR/rules" "$CLAUDE_DIR/goldband-rules"
    remove_repo_component "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts"
    remove_repo_component "$REPO_DIR/shell/goldband-self-update.sh" "$SHELL_UPDATE_BIN"
    remove_repo_component "$REPO_DIR/shell/goldband-launchers.sh" "$SHELL_LAUNCHERS_FILE"
    remove_repo_component "$REPO_DIR/hooks/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh"
    remove_marked_block "$ZSHRC_FILE" "shell launchers"
    remove_empty_dir "$CLAUDE_BIN_DIR"
    remove_empty_dir "$CLAUDE_SHELL_DIR"
}

remove_paths() {
    local p
    for p in "$@"; do
        if [ -L "$p" ]; then
            rm "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        elif [ -e "$p" ]; then
            rm -rf "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        fi
    done
}

uninstall_claude_settings() {
    local settings_json="$CLAUDE_DIR/settings.json"
    [ -f "$settings_json" ] || return 0
    command -v jq >/dev/null 2>&1 || { echo "[錯誤] Claude settings uninstall requires jq" >&2; return 1; }
    local hooks_content existing_hooks preserved tmp
    hooks_content="$(read_expanded_hooks_content "$REPO_DIR/hooks/hooks.json" "$CLAUDE_DIR/hooks")" || return 1
    existing_hooks="$(jq '.hooks // {}' "$settings_json")" || return 1
    preserved="$(merge_claude_hooks_json "$existing_hooks" "$hooks_content" remove)" || return 1
    tmp="$(mktemp "${settings_json}.tmp.XXXXXX")" || return 1
    if ! jq --argjson hooks "$preserved" --arg command "$(claude_statusline_command)" \
        --arg legacy "bash $CLAUDE_DIR/statusline-command.sh" \
        --arg quoted "bash \"$CLAUDE_DIR/statusline-command.sh\"" '
        if has("hooks") then
            if ($hooks | length) == 0 then del(.hooks) else .hooks = $hooks end
        else . end
        | if .statusLine.command? == $command or .statusLine.command? == $legacy or .statusLine.command? == $quoted
          then del(.statusLine) else . end
    ' "$settings_json" > "$tmp"; then
        rm -f "$tmp"
        return 1
    fi
    replace_claude_settings "$settings_json" "$tmp" || return 1
    echo -e "  ${GREEN}[移除] Goldband hooks/statusLine；保留個人設定${NC}"
}

remove_repo_component() {
    local src="$1"
    local dest="$2"
    [ -e "$dest" ] || [ -L "$dest" ] || return 0
    if [ -L "$dest" ]; then
        if repo_link_points_to "$dest" "$src"; then rm "$dest"; fi
    elif [ -d "$src" ] && [ -d "$dest" ]; then
        local entry
        for entry in "$src"/* "$src"/.[!.]* "$src"/..?*; do
            [ -e "$entry" ] || [ -L "$entry" ] || continue
            remove_repo_component "$entry" "$dest/$(basename "$entry")" || return 1
        done
        remove_empty_dir "$dest"
    elif [ -f "$src" ] && [ -f "$dest" ] && cmp -s "$src" "$dest"; then
        rm "$dest"
    else
        echo "  [保留] Custom or modified path: $dest"
    fi
}

uninstall_codex_skills() {
    if [ -d "$CODEX_SKILLS_DIR" ] && [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
        remove_profile_skills "$CODEX_SKILLS_DIR" "$CODEX_SKILL_PROFILE_FILE"
        remove_empty_dir "$CODEX_SKILLS_DIR"
        echo -e "  ${GREEN}[移除] Codex skills${NC}"
    fi
}

uninstall_codex_prompt() {
    local src="$REPO_DIR/codex/prompts/goldband.md"
    if repo_link_points_to "$CODEX_PROMPTS_DIR" "$REPO_DIR/codex/prompts"; then
        rm "$CODEX_PROMPTS_DIR"
        echo -e "  ${GREEN}[移除] $CODEX_PROMPTS_DIR legacy symlink${NC}"
        return
    fi
    if repo_path_installed_from "$src" "$CODEX_GOLDBAND_PROMPT_FILE"; then
        rm "$CODEX_GOLDBAND_PROMPT_FILE"
        echo -e "  ${GREEN}[移除] $CODEX_GOLDBAND_PROMPT_FILE${NC}"
    elif [ -e "$CODEX_GOLDBAND_PROMPT_FILE" ]; then
        echo -e "  ${YELLOW}[保留] Codex prompt goldband.md — 不是 goldband 管理的檔案: $CODEX_GOLDBAND_PROMPT_FILE${NC}"
    fi
}

uninstall_codex_paths() {
    # The shared config and local rule approvals always belong to the user.
    remove_repo_component "$REPO_DIR/codex/AGENTS.md" "$CODEX_AGENTS_FILE"
    remove_repo_component "$REPO_DIR/rules" "$CODEX_DIR/goldband-rules"
    remove_repo_component "$REPO_DIR/codex/agents" "$CODEX_CUSTOM_AGENTS_DIR"
    remove_repo_component "$REPO_DIR/codex/hooks.json" "$CODEX_HOOKS_FILE"
    remove_repo_component "$REPO_DIR/codex/hooks" "$CODEX_HOOKS_DIR"
    remove_repo_component "$REPO_DIR/codex/rules/default.rules" "$CODEX_RULES_DIR/goldband.rules"
    remove_repo_component "$REPO_DIR/hooks/scripts/lib/rules-resolver.js" "$CODEX_REVIEW_RUNTIME_FILE"
    local codex_paths=(
        "$CODEX_DIR/goldband/workflow-runtime"
        "$CODEX_DIR/goldband/review-runtime"
    )
    local profile_path
    while IFS= read -r profile_path; do
        [ -n "$profile_path" ] || continue
        if codex_profile_installed_from "$REPO_DIR/codex/profiles/$(basename "$profile_path")" "$profile_path"; then
            rm "$profile_path"
        elif [ -e "$profile_path" ] || [ -L "$profile_path" ]; then
            echo "  [保留] Custom or modified Codex profile: $profile_path"
        fi
    done < <(codex_profile_paths)
    remove_paths "${codex_paths[@]}"
}

codex_profile_paths() {
    local codex_profile_dir="$REPO_DIR/codex/profiles"
    [ -d "$codex_profile_dir" ] || return 0
    local profile_file
    for profile_file in "$codex_profile_dir"/*.config.toml; do
        [ -f "$profile_file" ] || continue
        printf '%s\n' "$CODEX_DIR/$(basename "$profile_file")"
    done
}

uninstall_codex_requirements() {
    local src="$REPO_DIR/codex/requirements.toml"
    if [ -f "$src" ] && [ -f "$CODEX_REQUIREMENTS_FILE" ]; then
        if cmp -s "$src" "$CODEX_REQUIREMENTS_FILE" 2>/dev/null; then
            remove_codex_requirements_file
            echo -e "  ${GREEN}[移除] $CODEX_REQUIREMENTS_FILE${NC}"
        else
            echo -e "  ${YELLOW}[保留] Codex requirements 不同於 repo 版本: $CODEX_REQUIREMENTS_FILE${NC}"
        fi
    fi
}

remove_codex_requirements_file() {
    if [ "$(id -u)" -eq 0 ] || [ -w "$(dirname "$CODEX_REQUIREMENTS_FILE")" ]; then
        rm "$CODEX_REQUIREMENTS_FILE"
    else
        sudo rm "$CODEX_REQUIREMENTS_FILE"
    fi
}
