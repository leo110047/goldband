# This file must be sourced by bash, not executed directly.

do_uninstall() {
    echo -e "${YELLOW}移除安裝...${NC}"
    uninstall_claude_skills
    uninstall_claude_guidance
    uninstall_claude_paths
    uninstall_claude_settings
    uninstall_codex_skills
    uninstall_codex_prompt
    uninstall_codex_paths
    uninstall_codex_requirements
    uninstall_style_gate
    echo -e "${GREEN}完成${NC}"
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
        rm -rf "${skills_dir:?}/$skill"
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
    local paths=(
        "$CLAUDE_DIR/commands"
        "$CLAUDE_DIR/goldband-rules"
        "$CLAUDE_DIR/hooks/scripts"
        "$SHELL_UPDATE_BIN"
        "$SHELL_LAUNCHERS_FILE"
    )
    remove_paths "${paths[@]}"
    remove_statusline_command
    remove_shell_launcher_block "$ZSHRC_FILE"
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

remove_statusline_command() {
    local path="$CLAUDE_DIR/statusline-command.sh"
    if [ -L "$path" ] || [ -f "$path" ]; then
        rm "$path"
        echo -e "  ${GREEN}[移除] statusline-command.sh${NC}"
    fi
}

uninstall_claude_settings() {
    local settings_json="$CLAUDE_DIR/settings.json"
    if [ -f "$settings_json" ] && command -v jq &> /dev/null; then
        cp "$settings_json" "${settings_json}.bak"
        jq 'del(.hooks) | del(.statusLine)' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[移除] settings.json 中的 hooks/statusLine 設定（已備份為 .bak）${NC}"
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
    local codex_paths=(
        "$CODEX_CONFIG_FILE"
        "$CODEX_AGENTS_FILE"
        "$CODEX_DIR/goldband-rules"
        "$CODEX_CUSTOM_AGENTS_DIR"
        "$CODEX_HOOKS_FILE"
        "$CODEX_HOOKS_DIR"
        "$CODEX_RULES_DIR"
        "$CODEX_DIR/goldband/workflow-runtime"
        "$CODEX_DIR/goldband/review-runtime"
    )
    local profile_path
    while IFS= read -r profile_path; do
        [ -n "$profile_path" ] && codex_paths+=("$profile_path")
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

uninstall_style_gate() {
    local installed_runtime_owned=false
    if installed_style_gate_runtime_is_owned; then
        installed_runtime_owned=true
    fi
    if command -v git >/dev/null 2>&1; then
        local current_hooks_path
        current_hooks_path="$(git config --global --get core.hooksPath 2>/dev/null || true)"
        if paths_equivalent "$current_hooks_path" "$GIT_HOOKS_DIR" \
            && [ "$installed_runtime_owned" = true ]; then
            git config --global --unset core.hooksPath
            echo -e "  ${GREEN}[移除] global core.hooksPath goldband style gate${NC}"
        elif paths_equivalent "$current_hooks_path" "$LEGACY_GIT_HOOKS_DIR"; then
            git config --global --unset core.hooksPath
            echo -e "  ${GREEN}[移除] legacy global core.hooksPath goldband style gate${NC}"
        elif [ -n "$current_hooks_path" ]; then
            echo -e "  ${YELLOW}[保留] global core.hooksPath — 不是 goldband 管理: $current_hooks_path${NC}"
        fi
    fi
    if [ "$installed_runtime_owned" = true ]; then
        remove_installed_style_gate_hooks
    fi
}

installed_style_gate_runtime_is_owned() {
    local marker="$GIT_HOOKS_DIR/.goldband-source"
    local kind relative checksum bytes extra
    local saw_pre_commit=false
    local saw_commit_msg=false
    local saw_project_hook=false
    [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
    [ "$(sed -n '2p' "$marker")" = "schemaVersion=1" ] || return 1
    while IFS=$'\t' read -r kind relative checksum bytes extra; do
        [ "$kind" = "file" ] || return 1
        [ -n "$checksum" ] && [[ "$checksum" =~ ^[0-9]+$ ]] || return 1
        [ -n "$bytes" ] && [[ "$bytes" =~ ^[0-9]+$ ]] || return 1
        [ -z "$extra" ] || return 1
        case "$relative" in
            pre-commit)
                [ "$saw_pre_commit" = false ] || return 1
                saw_pre_commit=true
                ;;
            commit-msg)
                [ "$saw_commit_msg" = false ] || return 1
                saw_commit_msg=true
                ;;
            lib/project-hook.sh)
                [ "$saw_project_hook" = false ] || return 1
                saw_project_hook=true
                ;;
            *) return 1 ;;
        esac
    done < <(sed -n '3,$p' "$marker")
    [ "$saw_pre_commit" = true ] \
        && [ "$saw_commit_msg" = true ] \
        && [ "$saw_project_hook" = true ]
}

remove_installed_style_gate_hooks() {
    local marker="$GIT_HOOKS_DIR/.goldband-source"
    local kind relative checksum bytes extra
    while IFS=$'\t' read -r kind relative checksum bytes extra; do
        remove_owned_style_gate_file "$relative" "$checksum" "$bytes"
    done < <(sed -n '3,$p' "$marker")
    rm -f "$marker"
    rmdir "$GIT_HOOKS_DIR/lib" 2>/dev/null || true
    rmdir "$GIT_HOOKS_DIR" 2>/dev/null || true
}

remove_owned_style_gate_file() {
    local relative="$1"
    local expected_checksum="$2"
    local expected_bytes="$3"
    local target="$GIT_HOOKS_DIR/$relative"
    local checksum bytes ignored
    [ -e "$target" ] || return 0
    if [ -f "$target" ] && [ ! -L "$target" ]; then
        IFS=' ' read -r checksum bytes ignored < <(cksum "$target")
        if [ "$checksum" = "$expected_checksum" ] && [ "$bytes" = "$expected_bytes" ]; then
            rm -f "$target"
            return 0
        fi
    fi
    echo -e "  ${YELLOW}[保留] installed hook 已修改或不是一般檔案: $target${NC}"
}
