# This file must be sourced by bash, not executed directly.

show_app_surface_status() {
    show_codex_app_shared_config_status
    show_codex_plugin_package_status
    show_claude_app_adapter_status
}

show_codex_app_shared_config_status() {
    local missing=()
    local stale=()
    local invalid=()
    local unverifiable=()

    if [ ! -e "$CODEX_CONFIG_FILE" ]; then
        missing+=("~/.codex/config.toml")
    elif ! is_valid_codex_config "$CODEX_CONFIG_FILE"; then
        case "$CODEX_CONFIG_FRESHNESS_REASON" in
            invalid-toml|incompatible-table) invalid+=("~/.codex/config.toml") ;;
            syntax-unverifiable|source-missing|source-unsupported) unverifiable+=("~/.codex/config.toml") ;;
            *) stale+=("~/.codex/config.toml") ;;
        esac
    fi
    if [ ! -e "$CODEX_HOOKS_FILE" ]; then
        missing+=("~/.codex/hooks.json")
    elif ! repo_path_installed_from "$REPO_DIR/codex/hooks.json" "$CODEX_HOOKS_FILE"; then
        stale+=("~/.codex/hooks.json")
    fi
    if [ ! -e "$CODEX_HOOKS_DIR" ]; then
        missing+=("~/.codex/hooks")
    elif ! repo_path_installed_from "$REPO_DIR/codex/hooks" "$CODEX_HOOKS_DIR"; then
        stale+=("~/.codex/hooks")
    fi
    if [ ! -e "$CODEX_AGENTS_FILE" ]; then
        missing+=("~/.codex/AGENTS.md")
    elif ! repo_path_installed_from "$REPO_DIR/codex/AGENTS.md" "$CODEX_AGENTS_FILE"; then
        stale+=("~/.codex/AGENTS.md")
    fi
    if ! [ -d "$CODEX_SKILLS_DIR" ] || ! [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
        missing+=("~/.agents/skills")
    fi

    if [ "${#missing[@]}" -eq 0 ] && [ "${#stale[@]}" -eq 0 ] && \
       [ "${#invalid[@]}" -eq 0 ] && [ "${#unverifiable[@]}" -eq 0 ]; then
        echo -e "  ${GREEN}[OK]${NC} Codex app compatible shared config (codex-full surfaces installed)"
    else
        echo -e "  ${YELLOW}[未完整]${NC} Codex app compatible shared config — 建議重跑 ./install.sh codex-full"
        [ "${#missing[@]}" -eq 0 ] || echo "    missing: $(join_by_comma "${missing[@]}")"
        [ "${#stale[@]}" -eq 0 ] || echo "    stale: $(join_by_comma "${stale[@]}")"
        [ "${#invalid[@]}" -eq 0 ] || echo "    invalid: $(join_by_comma "${invalid[@]}")"
        [ "${#unverifiable[@]}" -eq 0 ] || echo "    unverifiable: $(join_by_comma "${unverifiable[@]}")"
    fi
}

show_codex_plugin_package_status() {
    local plugin_root="$REPO_DIR/plugin-assets/codex-plugin"
    local manifest="$plugin_root/.codex-plugin/plugin.json"
    local marketplace="$REPO_DIR/.agents/plugins/marketplace.json"

    if [ -f "$manifest" ] && [ -d "$plugin_root/skills" ] && [ -f "$plugin_root/.mcp.json" ]; then
        echo -e "  ${GREEN}[OK]${NC} Codex plugin package available -> plugin-assets/codex-plugin"
    else
        echo -e "  ${RED}[未產生]${NC} Codex plugin package — 執行 npm run sync:app-support"
    fi

    if [ -f "$marketplace" ] && grep -q '"./plugin-assets/codex-plugin"' "$marketplace" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Codex repo marketplace -> .agents/plugins/marketplace.json"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} Codex repo marketplace entry"
    fi
}

show_claude_app_adapter_status() {
    local desktop_manifest="$REPO_DIR/app-adapters/claude-desktop/goldband-local-extension/manifest.json"
    local desktop_package="$REPO_DIR/app-adapters/claude-desktop/dist/goldband-local-extension.mcpb"
    local remote_template="$REPO_DIR/app-adapters/claude-remote/goldband-connector.template.json"
    local remote_marker="$HOME/.goldband/app-adapters/claude-remote/goldband-connector.json"

    if [ -f "$desktop_manifest" ] && [ -f "$desktop_package" ]; then
        echo -e "  ${GREEN}[OK]${NC} Claude Desktop local extension package -> app-adapters/claude-desktop/dist/goldband-local-extension.mcpb"
    elif [ -f "$desktop_manifest" ]; then
        echo -e "  ${YELLOW}[可建置]${NC} Claude Desktop local extension manifest exists — 執行 npm run sync:app-support 產生 .mcpb"
    else
        echo -e "  ${RED}[未產生]${NC} Claude Desktop local extension adapter"
    fi

    if claude_desktop_extension_install_detected; then
        echo -e "  ${GREEN}[OK]${NC} Claude Desktop local extension installed (best-effort local readback)"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} Claude Desktop local extension not detected locally"
    fi

    if [ -f "$remote_template" ]; then
        echo -e "  ${GREEN}[OK]${NC} Claude remote MCP connector template -> app-adapters/claude-remote/goldband-connector.template.json"
    else
        echo -e "  ${RED}[未產生]${NC} Claude remote MCP connector template"
    fi

    if [ -f "$remote_marker" ]; then
        echo -e "  ${GREEN}[OK]${NC} Claude remote MCP connector registered marker -> $remote_marker"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} Claude remote MCP connector not registered on this machine"
    fi
}

claude_desktop_extension_install_detected() {
    local candidate
    for candidate in \
        "$HOME/.goldband/app-adapters/claude-desktop/goldband-local-extension.installed" \
        "$HOME/Library/Application Support/Claude/Claude Extensions/goldband-local-extension/manifest.json" \
        "$HOME/Library/Application Support/Claude/extensions/goldband-local-extension/manifest.json"
    do
        [ -e "$candidate" ] && return 0
    done
    return 1
}
