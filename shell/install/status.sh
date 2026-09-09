# This file must be sourced by bash, not executed directly.
profile_skill_count() {
    local profile_file="$1" skills_line skills_csv
    skills_line=$(grep '^skills=' "$profile_file" 2>/dev/null || true)
    skills_csv="${skills_line#skills=}"
    if [ -z "$skills_csv" ]; then printf '0\n'; return; fi
    echo "$skills_csv" | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' '
}

show_status() {
    GOLDBAND_STATUS_EXIT_CODE=0
    echo -e "${BLUE}安裝狀態檢查${NC}"
    show_claude_install_status
    show_claude_plugin_status
    show_claude_settings_status
    echo ""
    echo -e "${BLUE}Codex 狀態${NC}"
    show_codex_install_status
    echo ""
    echo -e "${BLUE}Auto update 狀態${NC}"
    show_auto_update_status
    echo ""
    echo -e "${BLUE}App surface 狀態${NC}"
    show_app_surface_status
    echo ""
    echo -e "${BLUE}Git style gate 狀態${NC}"
    show_git_style_gate_status
    echo ""
    echo -e "${BLUE}Goldband Loop 狀態${NC}"
    show_workflow_status
    return "$GOLDBAND_STATUS_EXIT_CODE"
}

show_claude_install_status() {
    show_claude_skills_status
    show_claude_goldband_entrypoint_status
    show_repo_path_status "claude CLAUDE.md" "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE" "$REPO_DIR/claude/CLAUDE.md" "claude-guidance"
    show_repo_path_status "commands" "$CLAUDE_DIR/commands" "$REPO_DIR/commands" "commands"
    show_repo_path_status "on-demand policies" "$CLAUDE_DIR/goldband-rules" "$REPO_DIR/rules" "rules"
    if repo_link_points_to "$CLAUDE_DIR/rules" "$REPO_DIR/rules"; then
        echo "  [過時] Claude still autoloads full Goldband rules; run ./install.sh rules"
        GOLDBAND_STATUS_EXIT_CODE=2
    fi
    show_repo_path_status "hooks" "$CLAUDE_DIR/hooks/scripts" "$REPO_DIR/hooks/scripts" "hooks"
    show_repo_path_status "statusline" "$CLAUDE_DIR/statusline-command.sh" "$REPO_DIR/hooks/statusline-command.sh" "hooks"
    show_shell_launcher_status
}

show_claude_goldband_entrypoint_status() {
    local alias="$SKILLS_DIR/_goldband-command" runtime_dir="$SKILLS_DIR/goldband"
    [ -e "$alias" ] || [ -L "$alias" ] || return 0

    if [ -f "$alias/.goldband-managed-skill" ] ||
        { [ -d "$alias" ] && [ -L "$alias/SKILL.md" ] && workflow_status_symlink_target_under_dir "$alias/SKILL.md" "$runtime_dir"; } ||
        { [ -d "$alias" ] && [ -f "$runtime_dir/SKILL.md" ] && cmp -s "$alias/SKILL.md" "$runtime_dir/SKILL.md" 2>/dev/null; }; then
        echo -e "  ${RED}[重複]${NC} legacy /goldband skill alias -> $alias"
        echo "    active selector should be: $CLAUDE_DIR/commands/goldband.md"
        echo "    建議: 重跑 ./install.sh workflow，或刪除 goldband-managed 的 _goldband-command alias。"
        GOLDBAND_STATUS_EXIT_CODE=2
    else
        echo -e "  ${YELLOW}[外部設定]${NC} _goldband-command exists but is not goldband-managed -> $alias"
    fi
}

show_claude_skills_status() {
    if [ -L "$SKILLS_DIR" ]; then
        local skills_target
        skills_target=$(readlink "$SKILLS_DIR")
        echo -e "  ${GREEN}[OK]${NC} skills (legacy symlink) -> $skills_target"
    elif [ -d "$SKILLS_DIR" ] && [ -f "$SKILL_PROFILE_FILE" ]; then
        local profile_line profile skill_count
        profile_line=$(grep '^profile=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
        profile="${profile_line#profile=}"
        skill_count="$(profile_skill_count "$SKILL_PROFILE_FILE")"
        echo -e "  ${GREEN}[OK]${NC} skills profile: ${profile:-unknown} (${skill_count} 個)"
    elif [ -d "$SKILLS_DIR" ]; then
        echo -e "  ${YELLOW}[存在]${NC} skills 目錄存在，但不是 goldband profile 管理模式"
    else
        echo -e "  ${RED}[未安裝]${NC} skills"
    fi
}

show_repo_path_status() {
    local name="$1"
    local path="$2"
    local src="$3"
    local install_target="$4"
    if repo_link_points_to "$path" "$src"; then
        local target
        target=$(readlink "$path")
        echo -e "  ${GREEN}[OK]${NC} $name -> $target"
    elif [ -f "$src" ] && [ -f "$path" ] && cmp -s "$src" "$path" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} $name (copy fallback)"
    elif [ -L "$path" ]; then
        local target
        target=$(readlink "$path")
        echo -e "  ${YELLOW}[legacy symlink]${NC} $name -> $target — 建議重跑 ./install.sh $install_target"
    elif [ -e "$path" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} $name — 建議重跑 ./install.sh 轉成 repo-linked"
    else
        echo -e "  ${RED}[未安裝]${NC} $name"
    fi
}

show_shell_launcher_status() {
    if shell_launchers_installed; then
        echo -e "  ${GREEN}[OK]${NC} shell launchers (zsh)"
    elif [ -e "$SHELL_UPDATE_BIN" ] || [ -e "$SHELL_LAUNCHERS_FILE" ]; then
        echo -e "  ${YELLOW}[部分安裝]${NC} shell launchers — 建議重跑 ./install.sh launchers"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} shell launchers (zsh)"
    fi
    show_retired_windows_launcher_status
}

show_retired_windows_launcher_status() {
    is_windows_host || return 0

    local stale=()
    { [ -e "$CLAUDE_DIR/bin/goldband-self-update.ps1" ] || [ -L "$CLAUDE_DIR/bin/goldband-self-update.ps1" ]; } && stale+=("~/.claude/bin/goldband-self-update.ps1")
    { [ -e "$CLAUDE_DIR/shell/goldband-launchers.ps1" ] || [ -L "$CLAUDE_DIR/shell/goldband-launchers.ps1" ]; } && stale+=("~/.claude/shell/goldband-launchers.ps1")
    { [ -e "$CLAUDE_DIR/.goldband-windows-state.json" ] || [ -L "$CLAUDE_DIR/.goldband-windows-state.json" ]; } && stale+=("~/.claude/.goldband-windows-state.json")

    if [ "${#stale[@]}" -gt 0 ]; then
        echo -e "  ${RED}[stale]${NC} retired PowerShell launchers: $(join_by_comma "${stale[@]}")"
        echo "    建議: 重跑 ./install.sh launchers 清理舊 Windows wrapper。"
        GOLDBAND_STATUS_EXIT_CODE=2
    fi
}

show_claude_settings_status() {
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

show_claude_plugin_status() {
    echo -e "${BLUE}Claude plugin 狀態${NC}"
    if ! claude_plugin_status_prerequisites; then
        return 0
    fi

    local plugin_state
    plugin_state="$(read_goldband_claude_plugin_state)"
    print_goldband_claude_plugin_state "$plugin_state"
}

claude_plugin_status_prerequisites() {
    if ! command -v claude >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[無法檢查]${NC} claude CLI 不可用"
        return 1
    fi
    if ! command -v node >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[無法檢查]${NC} node 不可用，無法解析 claude plugin list"
        return 1
    fi
    return 0
}

read_goldband_claude_plugin_state() {
    local plugin_json
    plugin_json="$(claude plugin list --json 2>/dev/null || printf '[]')"
    PLUGIN_JSON="$plugin_json" node -e '
const plugins = JSON.parse(process.env.PLUGIN_JSON || "[]");
const plugin = plugins.find((entry) => entry.id === "goldband@goldband");
if (!plugin) {
  console.log("missing");
} else {
  const errors = Array.isArray(plugin.errors) ? plugin.errors.join("; ") : "";
  console.log([
    "installed",
    plugin.enabled ? "enabled" : "disabled",
    plugin.version || "unknown",
    plugin.installPath || "",
    errors
  ].join("\t"));
}
'
}

print_goldband_claude_plugin_state() {
    local plugin_state="$1"
    if [ "$plugin_state" = "missing" ]; then
        echo -e "  ${YELLOW}[未安裝]${NC} goldband@goldband plugin"
        show_goldband_claude_plugin_cache_status
        return 0
    fi

    local state enabled version install_path errors
    IFS=$'\t' read -r state enabled version install_path errors <<<"$plugin_state"
    if [ "$state" != "installed" ]; then
        echo -e "  ${YELLOW}[無法檢查]${NC} claude plugin list 回傳格式不明"
        GOLDBAND_STATUS_EXIT_CODE=2
        return 0
    fi

    if [ "$enabled" = "enabled" ] && [ -z "$errors" ]; then
        echo -e "  ${GREEN}[OK]${NC} goldband@goldband plugin (${version}) -> $install_path"
    elif [ "$enabled" = "disabled" ]; then
        echo -e "  ${YELLOW}[已安裝但停用]${NC} goldband@goldband plugin (${version}) -> $install_path"
    else
        echo -e "  ${RED}[錯誤]${NC} goldband@goldband plugin (${version}) -> $install_path"
        echo -e "    plugin errors: $errors"
        GOLDBAND_STATUS_EXIT_CODE=2
    fi

    if [ "$enabled" = "enabled" ]; then
        show_claude_plugin_duplicate_status
    fi
}

show_goldband_claude_plugin_cache_status() {
    local cache_root="$CLAUDE_DIR/plugins/cache/goldband/goldband" cache_versions

    [ -d "$cache_root" ] || return 0
    cache_versions="$(find "$cache_root" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | tr '\n' ' ')"
    [ -n "$cache_versions" ] || return 0

    echo -e "  ${YELLOW}[殘留]${NC} goldband@goldband plugin cache (${cache_versions}) -> $cache_root"
    echo "    plugin 未安裝；這是 stale cache，不是 active /goldband 入口。"
}

show_claude_plugin_duplicate_status() {
    local duplicates=()

    if repo_path_installed_from "$REPO_DIR/commands" "$CLAUDE_DIR/commands"; then
        duplicates+=("commands")
    fi
    if repo_path_installed_from "$REPO_DIR/rules" "$CLAUDE_DIR/goldband-rules" ||
        repo_path_installed_from "$REPO_DIR/rules" "$CLAUDE_DIR/rules"; then
        duplicates+=("rules")
    fi
    if repo_path_installed_from "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts"; then
        duplicates+=("hooks")
    fi
    if [ -d "$SKILLS_DIR" ] && [ -f "$SKILL_PROFILE_FILE" ]; then
        duplicates+=("skills")
    elif repo_link_points_to "$SKILLS_DIR" "$REPO_DIR/skills/global"; then
        duplicates+=("skills")
    fi

    if [ "${#duplicates[@]}" -eq 0 ]; then
        echo -e "  ${GREEN}[OK]${NC} plugin 與 installer 沒有偵測到 duplicate core asset"
        return 0
    fi

    local duplicate_list
    duplicate_list="$(join_by_comma "${duplicates[@]}")"
    echo -e "  ${YELLOW}[重複]${NC} plugin 與 installer 同時提供 core asset: $duplicate_list"
    echo "    active source: goldband@goldband plugin + installer-managed Claude files"
    echo "    建議: 外部使用者保留 plugin 並執行 ./install.sh uninstall；開發者保留 installer 時執行 claude plugin uninstall goldband@goldband。"
    GOLDBAND_STATUS_EXIT_CODE=2
}

show_codex_install_status() {
    show_codex_config_status
    show_codex_profiles_status
    show_codex_requirements_status
    show_repo_path_status "codex AGENTS.md" "$CODEX_AGENTS_FILE" "$REPO_DIR/codex/AGENTS.md" "codex-agents"
    show_repo_path_status "codex on-demand policies" "$CODEX_DIR/goldband-rules" "$REPO_DIR/rules" "codex-agents"
    show_repo_path_status "codex custom agents" "$CODEX_CUSTOM_AGENTS_DIR" "$REPO_DIR/codex/agents" "codex-agents"
    show_codex_prompts_status
    show_repo_path_status "codex hooks.json" "$CODEX_HOOKS_FILE" "$REPO_DIR/codex/hooks.json" "codex-hooks"
    show_repo_path_status "codex hook scripts" "$CODEX_HOOKS_DIR" "$REPO_DIR/codex/hooks" "codex-hooks"
    show_repo_path_status "codex review Rules runtime" "$CODEX_REVIEW_RUNTIME_FILE" "$REPO_DIR/hooks/scripts/lib/rules-resolver.js" "codex-hooks"
    show_codex_rules_status
    show_codex_skills_status
    show_codex_workflow_launcher_status
    show_mcp_token_status
}

codex_workflow_policy_allows() {
    local codex_path="$1" rule="$2"
    shift 2
    "$codex_path" execpolicy check --rules "$rule" -- "$@" 2>/dev/null \
        | grep -q '"decision":"allow"'
}

show_codex_workflow_launcher_status() {
    local marker="$HOME/.codex/skills/goldband/.workflow-launcher.json" rule="$HOME/.codex/rules/goldband-workflows.rules"
    local marker_values bun_path launcher_path marker_rule runtime_root
    if [ ! -f "$marker" ] || [ ! -f "$rule" ]; then
        echo -e "  ${YELLOW}[未安裝]${NC} trusted Codex workflow launcher — 重跑 ./install.sh workflow-codex"
        return 0
    fi
    if ! command -v node >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[無法檢查]${NC} trusted Codex workflow launcher — node 不可用"
        return 0
    fi
    marker_values="$(node -e '
const fs = require("node:fs"), marker = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (marker.schemaVersion !== 1 || !Array.isArray(marker.argvPrefix) || marker.argvPrefix.length !== 2) process.exit(2);
if (typeof marker.ruleFile !== "string" || typeof marker.runtimeRoot !== "string") process.exit(2);
process.stdout.write(marker.argvPrefix[0] + "\t" + marker.argvPrefix[1] + "\t" + marker.ruleFile + "\t" + marker.runtimeRoot);
' "$marker" 2>/dev/null || true)"
    IFS=$'\t' read -r bun_path launcher_path marker_rule runtime_root <<<"$marker_values"
    local trusted_config="$runtime_root/trusted-runtime.json" config_values config_bun codex_path browser_path browser_server rules_resolver rules_directory
    config_values="$(node -e '
const fs = require("node:fs"), config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (config.schemaVersion !== 2) process.exit(2);
for (const field of ["bunExecutable", "codexExecutable", "browserExecutable", "browserServerScript", "rulesResolverScript", "rulesDirectory"]) {
  if (typeof config[field] !== "string" || !config[field]) process.exit(2);
}
process.stdout.write([config.bunExecutable, config.codexExecutable, config.browserExecutable, config.browserServerScript, config.rulesResolverScript, config.rulesDirectory].join("\t"));
' "$trusted_config" 2>/dev/null || true)"
    IFS=$'\t' read -r config_bun codex_path browser_path browser_server rules_resolver rules_directory <<<"$config_values"
    if [ ! -x "$bun_path" ] || [ "$config_bun" != "$bun_path" ] || [ ! -x "$codex_path" ] || [ ! -f "$launcher_path" ] || [ ! -f "$trusted_config" ] || [ ! -x "$browser_path" ] || [ ! -f "$browser_server" ] || [ ! -f "$rules_resolver" ] || [ ! -d "$rules_directory" ] || [ ! -f "$rules_directory/manifest.json" ] || [ "$marker_rule" != "$rule" ]; then
        echo -e "  ${RED}[stale]${NC} trusted Codex workflow launcher — marker target missing or inconsistent"
        echo "    建議: 重跑 ./install.sh workflow-codex。"
        GOLDBAND_STATUS_EXIT_CODE=2
        return 0
    fi
    if ! verify_codex_workflow_distribution "$runtime_root" "$bun_path" "$launcher_path" "$marker" "$rule"; then
        GOLDBAND_STATUS_EXIT_CODE=2
        return 0
    fi
    if ! codex_workflow_policy_allows "$codex_path" "$rule" "$bun_path" "$launcher_path" review code --host codex; then
        echo -e "  ${RED}[stale]${NC} trusted Codex workflow launcher — pinned Codex does not match the review allow rule"
        GOLDBAND_STATUS_EXIT_CODE=2
        return 0
    fi
    if ! codex_workflow_policy_allows "$codex_path" "$rule" "$bun_path" "$launcher_path" browser session --host codex status; then
        echo -e "  ${RED}[stale]${NC} trusted Codex workflow launcher — pinned Codex does not match the browser allow rule"
        GOLDBAND_STATUS_EXIT_CODE=2
        return 0
    fi
    echo -e "  ${GREEN}[OK]${NC} trusted Codex workflow launcher (pinned Codex + exact review/browser rules)"
}

show_codex_config_status() {
    if is_generated_codex_config "$CODEX_CONFIG_FILE"; then
        if ! is_current_generated_codex_config "$CODEX_CONFIG_FILE"; then
            case "$CODEX_CONFIG_FRESHNESS_REASON" in
                invalid-toml)
                    echo -e "  ${RED}[invalid]${NC} codex-config — installed config.toml is not valid TOML"
                    echo "    修正 TOML syntax 後再重跑 ./install.sh status。"
                    ;;
                syntax-unverifiable)
                    echo -e "  ${RED}[unverifiable]${NC} codex-config — TOML parser unavailable"
                    echo "    需要 Python 3.11+ tomllib（python3、python 或 py -3）。"
                    ;;
                source-missing|source-unsupported)
                    echo -e "  ${RED}[unverifiable]${NC} codex-config — Goldband config source cannot be projected safely"
                    ;;
                *)
                    echo -e "  ${RED}[stale]${NC} codex-config — managed content differs from current sources"
                    echo "    建議: 重跑 ./install.sh codex-config。"
                    ;;
            esac
            GOLDBAND_STATUS_EXIT_CODE=2
        elif [ -f "$REPO_DIR/codex/local/config.toml" ]; then
            echo -e "  ${GREEN}[OK]${NC} codex-config (generated base + local overlay)"
        else
            echo -e "  ${GREEN}[OK]${NC} codex-config (generated base only)"
        fi
    elif [ -L "$CODEX_CONFIG_FILE" ]; then
        local target
        target=$(readlink "$CODEX_CONFIG_FILE")
        echo -e "  ${YELLOW}[legacy symlink]${NC} codex-config -> $target — 建議重跑 ./install.sh codex-config"
    elif [ -e "$CODEX_CONFIG_FILE" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} codex-config — 建議重跑 ./install.sh codex-config"
    else
        echo -e "  ${RED}[未安裝]${NC} codex-config"
    fi
}

show_codex_profiles_status() {
    local profile_source_dir="$REPO_DIR/codex/profiles"
    [ -d "$profile_source_dir" ] || return 0
    local profile_total=0 profile_installed=0 profile_copy_count=0 profile_file
    for profile_file in "$profile_source_dir"/*.config.toml; do
        [ -f "$profile_file" ] || continue
        profile_total=$((profile_total + 1))
        local profile_dest="$CODEX_DIR/$(basename "$profile_file")"
        if codex_profile_installed_from "$profile_file" "$profile_dest"; then
            profile_installed=$((profile_installed + 1))
            if [ ! -L "$profile_dest" ]; then
                profile_copy_count=$((profile_copy_count + 1))
            fi
        fi
    done
    if [ "$profile_total" -gt 0 ] && [ "$profile_installed" -eq "$profile_total" ]; then
        if [ "$profile_copy_count" -gt 0 ]; then
            echo -e "  ${GREEN}[OK]${NC} codex profiles (${profile_installed}/${profile_total}, materialized copies)"
        else
            echo -e "  ${YELLOW}[legacy symlink]${NC} codex profiles (${profile_installed}/${profile_total}) — 建議重跑 ./install.sh codex-config"
        fi
    elif [ "$profile_installed" -gt 0 ]; then
        echo -e "  ${YELLOW}[部分安裝]${NC} codex profiles (${profile_installed}/${profile_total}) — 建議重跑 ./install.sh codex-config"
    else
        echo -e "  ${RED}[未安裝]${NC} codex profiles"
    fi
}

show_codex_requirements_status() {
    local src="$REPO_DIR/codex/requirements.toml"
    [ -f "$src" ] || return 0
    if [ -f "$CODEX_REQUIREMENTS_FILE" ] && cmp -s "$src" "$CODEX_REQUIREMENTS_FILE" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} codex requirements -> $CODEX_REQUIREMENTS_FILE"
    elif [ -f "$CODEX_REQUIREMENTS_FILE" ]; then
        echo -e "  ${YELLOW}[存在]${NC} codex requirements 不同於 repo 版本 -> $CODEX_REQUIREMENTS_FILE"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} codex requirements — 執行 ./install.sh codex-requirements"
    fi
}

show_codex_prompts_status() {
    if repo_link_points_to "$CODEX_PROMPTS_DIR" "$REPO_DIR/codex/prompts"; then
        local target
        target=$(readlink "$CODEX_PROMPTS_DIR")
        echo -e "  ${YELLOW}[legacy symlink]${NC} codex prompts -> $target — 建議重跑 ./install.sh codex-prompts"
        return
    fi
    show_repo_path_status "codex prompt goldband.md" "$CODEX_GOLDBAND_PROMPT_FILE" "$REPO_DIR/codex/prompts/goldband.md" "codex-prompts"
}

show_codex_rules_status() {
    if [ -L "$CODEX_RULES_DIR" ]; then
        local target
        target=$(readlink "$CODEX_RULES_DIR")
        echo -e "  ${YELLOW}[legacy symlink]${NC} codex-rules -> $target — 建議重跑 ./install.sh codex-rules"
    elif [ -d "$CODEX_RULES_DIR" ]; then
        show_codex_rules_dir_status
    elif [ -e "$CODEX_RULES_DIR" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} codex-rules — 建議重跑 ./install.sh codex-rules"
    else
        echo -e "  ${RED}[未安裝]${NC} codex-rules"
    fi
}

show_codex_rules_dir_status() {
    local local_default="$REPO_DIR/codex/local/rules/default.rules"
    local goldband_default="$REPO_DIR/codex/rules/default.rules"
    if repo_path_installed_from "$local_default" "$CODEX_RULES_DIR/default.rules" &&
        repo_path_installed_from "$goldband_default" "$CODEX_RULES_DIR/goldband.rules"; then
        local rule_count
        rule_count=$(find "$CODEX_RULES_DIR" -name '*.rules' 2>/dev/null | wc -l | tr -d ' ')
        echo -e "  ${GREEN}[OK]${NC} codex-rules (${rule_count} 個 rule file)"
    elif ! repo_path_installed_from "$goldband_default" "$CODEX_RULES_DIR/goldband.rules"; then
        echo -e "  ${YELLOW}[存在]${NC} codex-rules 目錄存在，但缺少 goldband.rules portable link"
    else
        echo -e "  ${YELLOW}[存在]${NC} codex-rules 目錄存在，但缺少 default.rules link"
    fi
}

show_codex_skills_status() {
    if [ -d "$CODEX_SKILLS_DIR" ] && [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
        local profile_line profile skill_count
        profile_line=$(grep '^profile=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
        profile="${profile_line#profile=}"
        skill_count="$(profile_skill_count "$CODEX_SKILL_PROFILE_FILE")"
        echo -e "  ${GREEN}[OK]${NC} codex skills profile: ${profile:-unknown} (${skill_count} 個)"
    elif [ -d "$CODEX_SKILLS_DIR" ]; then
        echo -e "  ${YELLOW}[存在]${NC} codex skills 目錄存在，但不是 goldband profile 管理模式"
    else
        echo -e "  ${RED}[未安裝]${NC} codex skills"
    fi
}

show_mcp_token_status() {
    if command -v node >/dev/null 2>&1 && [ -f "$REPO_DIR/scripts/check-mcp-token-status.mjs" ]; then
        node "$REPO_DIR/scripts/check-mcp-token-status.mjs" --summary --mcp-env-file "$REPO_DIR/codex/local/mcp.env" 2>/dev/null || true
    fi
}

show_git_style_gate_status() {
    if command -v git >/dev/null 2>&1; then
        local current_hooks_path
        current_hooks_path="$(git config --global --get core.hooksPath 2>/dev/null || true)"
        if paths_equivalent "$current_hooks_path" "$GIT_HOOKS_DIR"; then
            if style_gate_runtime_matches_source; then
                echo -e "  ${GREEN}[OK]${NC} global core.hooksPath -> $GIT_HOOKS_DIR"
            else
                echo -e "  ${YELLOW}[stale]${NC} Git style gate runtime 與目前 repo 不一致；請執行 ./install.sh style-gate"
            fi
        elif paths_equivalent "$current_hooks_path" "$LEGACY_GIT_HOOKS_DIR"; then
            echo -e "  ${YELLOW}[stale]${NC} global core.hooksPath 仍指向 source checkout；請執行 ./install.sh style-gate"
        elif [ -n "$current_hooks_path" ]; then
            echo -e "  ${YELLOW}[外部設定]${NC} global core.hooksPath -> $current_hooks_path"
        else
            echo -e "  ${RED}[未安裝]${NC} global core.hooksPath 未設定"
        fi
    else
        echo -e "  ${YELLOW}[無法檢查]${NC} git 不可用"
    fi
}

style_gate_runtime_matches_source() {
    local relative
    [ -f "$GIT_HOOKS_DIR/.goldband-source" ] || return 1
    [ "$(sed -n '1p' "$GIT_HOOKS_DIR/.goldband-source")" = "$REPO_DIR" ] || return 1
    for relative in pre-commit commit-msg lib/project-hook.sh; do
        cmp -s "$GIT_HOOKS_SOURCE_DIR/$relative" "$GIT_HOOKS_DIR/$relative" 2>/dev/null || return 1
    done
}

show_workflow_status() {
    local workflow_claude_dir="$HOME/.claude/skills/goldband"
    local workflow_codex_dir="$HOME/.codex/skills/goldband"
    show_workflow_runtime_status "Claude runtime" "$workflow_claude_dir"
    show_workflow_runtime_status "Codex runtime" "$workflow_codex_dir"
    show_workflow_profile_status "Claude" "claude" "$HOME/.claude/skills" "$workflow_claude_dir"
    show_workflow_profile_status "Codex" "codex" "$HOME/.codex/skills" "$workflow_codex_dir"
    show_knowledge_system_status "$workflow_claude_dir" "$workflow_codex_dir"
    show_workflow_state_dir_status
    show_tracker_projection_status
    show_goldband_wrapper_language_status
}

show_workflow_runtime_status() {
    local label="$1"
    local workflow_dir="$2"
    local workflow_version contract_source expected_contract installed_contract
    if [ -d "$workflow_dir" ]; then
        workflow_version="$(read_workflow_version "$workflow_dir" 2>/dev/null || echo "unknown")"
        contract_source="$(workflow_contract_source "$workflow_dir" 2>/dev/null || true)"
        expected_contract="$(workflow_contract_fingerprint "$contract_source" 2>/dev/null || true)"
        installed_contract="$(cat "$workflow_dir/.installed-contract" 2>/dev/null || true)"
        if [ -f "$workflow_dir/.installed-source" ] && [ -z "$expected_contract" ]; then
            echo -e "  ${RED}[unverifiable]${NC} Goldband Loop $label (${workflow_version}) — workflow contract source unavailable"
            echo "    source: ${contract_source:-$(cat "$workflow_dir/.installed-source" 2>/dev/null || echo unknown)}"
            GOLDBAND_STATUS_EXIT_CODE=2
        elif [ -n "$expected_contract" ] &&
            { [ -n "$installed_contract" ] || [ -f "$workflow_dir/.installed-version" ]; } &&
            [ "$installed_contract" != "$expected_contract" ]; then
            echo -e "  ${RED}[stale]${NC} Goldband Loop $label (${workflow_version}) — workflow contract drift"
            echo "    建議: 重跑 ./install.sh workflow 或 workflow-codex。"
            GOLDBAND_STATUS_EXIT_CODE=2
        else
            echo -e "  ${GREEN}[OK]${NC} Goldband Loop $label (${workflow_version})"
        fi
    else
        echo -e "  ${YELLOW}[未安裝]${NC} Goldband Loop $label"
    fi
}

workflow_contract_source() {
    local workflow_dir="$1"
    local installed_source

    if [ -f "$workflow_dir/.installed-source" ]; then
        installed_source="$(cat "$workflow_dir/.installed-source" 2>/dev/null || true)"
        [ -n "$installed_source" ] || return 1
        printf '%s\n' "$installed_source"
        return 0
    fi

    resolve_workflow_repo_dir
}

workflow_profile_value() {
    local host="$1"
    local marker="$HOME/.goldband/state/workflow-profile-$host"
    if [ -f "$marker" ]; then
        tr -d '\n' < "$marker"
    else
        printf 'unknown'
    fi
}

show_workflow_profile_status() {
    local label="$1"
    local host="$2"
    local skills_dir="$3"
    local runtime_dir="$4"
    [ -d "$skills_dir" ] || return 0
    local profile exposed goldband_top_level generated_root
    profile="$(workflow_profile_value "$host")"
    generated_root="$(workflow_generated_root_for_runtime "$runtime_dir" 2>/dev/null || true)"
    exposed="$(workflow_exposed_skill_count "$skills_dir" "$runtime_dir" "$generated_root")"
    goldband_top_level="$(workflow_goldband_top_level_count "$skills_dir" "$runtime_dir" "$generated_root")"
    echo -e "  ${GREEN}[OK]${NC} Goldband Loop $label workflow profile: ${profile} (${exposed} exposed skills, ${goldband_top_level} top-level workflows)"
}

show_workflow_state_dir_status() {
    if [ -d "$HOME/.goldband/projects" ]; then
        echo -e "  ${GREEN}[OK]${NC} Goldband Loop state dir (~/.goldband/projects)"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} Goldband Loop state dir (~/.goldband/projects)"
    fi
}

show_goldband_wrapper_language_status() {
    local workflow_config_bin goldband_language
    if workflow_config_bin="$(find_workflow_config_bin 2>/dev/null)"; then
        goldband_language="$(read_goldband_wrapper_language "$workflow_config_bin")"
        echo -e "  ${GREEN}[OK]${NC} Goldband Loop language (${goldband_language})"
    fi
}
