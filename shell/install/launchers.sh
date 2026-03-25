# This file must be sourced by bash, not executed directly.

shell_launcher_block() {
    cat <<'EOF'
# >>> goldband shell launchers >>>
if [ -f "$HOME/.claude/shell/goldband-launchers.sh" ]; then
    source "$HOME/.claude/shell/goldband-launchers.sh"
fi
# <<< goldband shell launchers <<<
EOF
}

upsert_shell_launcher_block() {
    local rc_file="$1"
    local temp_file

    mkdir -p "$(dirname "$rc_file")"
    [ -f "$rc_file" ] || touch "$rc_file"
    temp_file="$(strip_shell_launcher_block "$rc_file")" || return 1

    if [ -s "$temp_file" ]; then
        printf '\n' >> "$temp_file" || {
            rm -f "$temp_file"
            return 1
        }
    fi
    shell_launcher_block >> "$temp_file" || {
        rm -f "$temp_file"
        return 1
    }

    mv "$temp_file" "$rc_file"
}

strip_shell_launcher_block() {
    local rc_file="$1"
    local begin_marker="# >>> goldband shell launchers >>>"
    local end_marker="# <<< goldband shell launchers <<<"
    local temp_file

    [ -f "$rc_file" ] || return 1
    temp_file="$(mktemp)"

    awk -v begin="$begin_marker" -v end="$end_marker" '
        BEGIN { skipping = 0 }
        $0 == begin { skipping = 1; next }
        skipping == 1 && $0 == end { skipping = 0; next }
        skipping == 0 { print }
    ' "$rc_file" > "$temp_file" || {
        rm -f "$temp_file"
        return 1
    }

    printf '%s\n' "$temp_file"
}

remove_shell_launcher_block() {
    local rc_file="$1"
    local temp_file

    [ -f "$rc_file" ] || return 0
    temp_file="$(strip_shell_launcher_block "$rc_file")" || return 1
    mv "$temp_file" "$rc_file"
}

install_shell_launchers() {
    link_component "$REPO_DIR/shell/goldband-self-update.sh" "$SHELL_UPDATE_BIN" "Shell self-update script"
    link_component "$REPO_DIR/shell/goldband-launchers.sh" "$SHELL_LAUNCHERS_FILE" "Shell launcher wrappers"
    upsert_shell_launcher_block "$ZSHRC_FILE"
    echo -e "  ${GREEN}[安裝] zsh 啟動整合${NC}"
}

shell_launchers_installed() {
    [ -L "$SHELL_UPDATE_BIN" ] || return 1
    [ -L "$SHELL_LAUNCHERS_FILE" ] || return 1
    [ -f "$ZSHRC_FILE" ] || return 1
    grep -q '^# >>> goldband shell launchers >>>$' "$ZSHRC_FILE"
}

install_launchers() {
    install_shell_launchers
}
