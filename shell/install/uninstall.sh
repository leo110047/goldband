# This file must be sourced by bash, not executed directly.

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
        local skill_array=()
        read_profile_skill_array "$skills_csv" skill_array
        for skill in "${skill_array[@]}"; do
            rm -rf "${SKILLS_DIR:?}/$skill"
        done
        rm -rf "$SKILLS_DIR/README.md" "$SKILLS_DIR/skill-rules.json"
        rm -f "$SKILL_PROFILE_FILE"
        if [ -z "$(ls -A "$SKILLS_DIR" 2>/dev/null)" ]; then
            rmdir "$SKILLS_DIR"
        fi
        echo -e "  ${GREEN}[移除] skills${NC}"
    fi

    local paths=("$CLAUDE_DIR/commands" "$CLAUDE_DIR/contexts" "$CLAUDE_DIR/rules" "$CLAUDE_DIR/hooks/scripts" "$SHELL_UPDATE_BIN" "$SHELL_LAUNCHERS_FILE")

    for p in "${paths[@]}"; do
        if [ -L "$p" ]; then
            rm "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        elif [ -e "$p" ]; then
            rm -rf "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        fi
    done

    if [ -L "$CLAUDE_DIR/statusline-command.sh" ]; then
        rm "$CLAUDE_DIR/statusline-command.sh"
        echo -e "  ${GREEN}[移除] statusline-command.sh${NC}"
    elif [ -f "$CLAUDE_DIR/statusline-command.sh" ]; then
        rm "$CLAUDE_DIR/statusline-command.sh"
        echo -e "  ${GREEN}[移除] statusline-command.sh${NC}"
    fi

    remove_shell_launcher_block "$ZSHRC_FILE"
    if [ -d "$CLAUDE_BIN_DIR" ] && [ -z "$(ls -A "$CLAUDE_BIN_DIR" 2>/dev/null)" ]; then
        rmdir "$CLAUDE_BIN_DIR"
    fi
    if [ -d "$CLAUDE_SHELL_DIR" ] && [ -z "$(ls -A "$CLAUDE_SHELL_DIR" 2>/dev/null)" ]; then
        rmdir "$CLAUDE_SHELL_DIR"
    fi

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
        local skill_array=()
        read_profile_skill_array "$skills_csv" skill_array
        for skill in "${skill_array[@]}"; do
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
