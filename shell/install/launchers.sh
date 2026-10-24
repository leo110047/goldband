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

# Marked blocks are delimited by "# >>> goldband <name> >>>" and
# "# <<< goldband <name> <<<" lines that goldband owns in a startup file.
upsert_marked_block() {
    local rc_file="$1"
    local name="$2"
    local block_fn="$3"
    local temp_file

    mkdir -p "$(dirname "$rc_file")"
    [ -f "$rc_file" ] || touch "$rc_file"
    temp_file="$(strip_marked_block "$rc_file" "$name")" || return 1

    if [ -s "$temp_file" ]; then
        printf '\n' >> "$temp_file" || {
            rm -f "$temp_file"
            return 1
        }
    fi
    "$block_fn" >> "$temp_file" || {
        rm -f "$temp_file"
        return 1
    }

    mv "$temp_file" "$rc_file"
}

strip_marked_block() {
    local rc_file="$1"
    local name="$2"
    local temp_file

    [ -f "$rc_file" ] || return 1
    temp_file="$(mktemp)"

    awk -v begin="# >>> goldband $name >>>" -v end="# <<< goldband $name <<<" '
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

remove_marked_block() {
    local rc_file="$1"
    local name="$2"
    local temp_file

    [ -f "$rc_file" ] || return 0
    temp_file="$(strip_marked_block "$rc_file" "$name")" || return 1
    mv "$temp_file" "$rc_file"
}

marked_block_installed() {
    [ -f "$1" ] && grep -qxF "# >>> goldband $2 >>>" "$1"
}

remove_powershell_launcher_block() {
    local profile_file="$1"

    marked_block_installed "$profile_file" "powershell launchers" || return 0
    remove_marked_block "$profile_file" "powershell launchers" || return 1
    echo -e "  ${GREEN}[移除] retired PowerShell launcher profile block -> $profile_file${NC}"
}

cleanup_retired_windows_launchers() {
    is_windows_host || return 0

    local stale_update="$CLAUDE_DIR/bin/goldband-self-update.ps1"
    local stale_launchers="$CLAUDE_DIR/shell/goldband-launchers.ps1"
    local stale_state="$CLAUDE_DIR/.goldband-windows-state.json"
    local powershell_profile="$HOME/Documents/PowerShell/Microsoft.PowerShell_profile.ps1"
    local windows_powershell_profile="$HOME/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1"

    if [ -e "$stale_update" ] || [ -L "$stale_update" ]; then
        backup_or_remove_existing_path "$stale_update"
        echo -e "  ${GREEN}[清理] retired PowerShell self-update wrapper${NC}"
    fi
    if [ -e "$stale_launchers" ] || [ -L "$stale_launchers" ]; then
        backup_or_remove_existing_path "$stale_launchers"
        echo -e "  ${GREEN}[清理] retired PowerShell launcher wrappers${NC}"
    fi
    if [ -e "$stale_state" ] || [ -L "$stale_state" ]; then
        backup_or_remove_existing_path "$stale_state"
        echo -e "  ${GREEN}[清理] retired PowerShell launcher state${NC}"
    fi

    remove_powershell_launcher_block "$powershell_profile"
    remove_powershell_launcher_block "$windows_powershell_profile"
}

install_shell_launchers() {
    cleanup_retired_windows_launchers
    link_component "$REPO_DIR/shell/goldband-self-update.sh" "$SHELL_UPDATE_BIN" "Shell self-update script"
    link_component "$REPO_DIR/shell/goldband-launchers.sh" "$SHELL_LAUNCHERS_FILE" "Shell launcher wrappers"
    upsert_marked_block "$ZSHRC_FILE" "shell launchers" shell_launcher_block
    echo -e "  ${GREEN}[安裝] zsh 啟動整合${NC}"
}

shell_launchers_installed() {
    repo_path_installed_from "$REPO_DIR/shell/goldband-self-update.sh" "$SHELL_UPDATE_BIN" || return 1
    repo_path_installed_from "$REPO_DIR/shell/goldband-launchers.sh" "$SHELL_LAUNCHERS_FILE" || return 1
    marked_block_installed "$ZSHRC_FILE" "shell launchers"
}

install_launchers() {
    install_shell_launchers
}
