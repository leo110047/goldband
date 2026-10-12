# This file must be sourced by bash, not executed directly.

resolve_workflow_repo_dir() {
    local candidates=()

    if [ -n "${GOLDBAND_LOOP_DIR:-}" ]; then
        candidates+=("$GOLDBAND_LOOP_DIR")
    fi
    if [ -n "${WORKFLOW_REPO_DIR:-}" ]; then
        candidates+=("$WORKFLOW_REPO_DIR")
    fi

    candidates+=(
        "$REPO_DIR/goldband-loop"
        "$HOME/.claude/skills/goldband"
        "$HOME/.codex/skills/goldband"
        "$HOME/goldband-loop"
        "$REPO_DIR/../goldband-loop"
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

read_workflow_version() {
    local repo_dir="$1"
    local version_file
    for version_file in "$repo_dir/VERSION" "$repo_dir/.installed-version"; do
        if [ -f "$version_file" ]; then
            tr -d '\n' < "$version_file"
            return 0
        fi
    done
    return 1
}

workflow_contract_fingerprint() {
    local repo_dir="$1"
    command -v node >/dev/null 2>&1 || return 1
    [ -f "$REPO_DIR/scripts/check-workflow-distribution.mjs" ] || return 1
    node "$REPO_DIR/scripts/check-workflow-distribution.mjs" source-digest "$repo_dir"
}

find_workflow_config_bin() {
    local candidate
    for candidate in \
        "$HOME/.codex/skills/goldband/bin/goldband-config" \
        "$HOME/.claude/skills/goldband/bin/goldband-config" \
        "$REPO_DIR/goldband-loop/bin/goldband-config"
    do
        if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

read_goldband_wrapper_language() {
    local workflow_config_bin="$1"
    local language
    language="$("$workflow_config_bin" get goldband_language 2>/dev/null || true)"
    if [ -n "$language" ]; then
        printf '%s\n' "$language"
    else
        printf 'zh-TW\n'
    fi
}

cleanup_workflow_user_entries() {
    local claude_skills_dir="$HOME/.claude/skills"
    local codex_skills_dir="$HOME/.codex/skills"
    local codex_agents_dir="$HOME/.agents/skills"
    local entry

    for entry in \
        "$claude_skills_dir/workflow" \
        "$claude_skills_dir/workflow.bak" \
        "$claude_skills_dir"/workflow.bak* \
        "$codex_skills_dir/workflow" \
        "$codex_skills_dir"/workflow-* \
        "$REPO_DIR/.agents/skills/workflow"
    do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        rm -rf "$entry" 2>/dev/null || true
    done
}

write_workflow_installed_versions() {
    local host="$1"
    local version="$2"
    local runtime_root

    [ -n "$version" ] || return 0

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        runtime_root="$HOME/.claude/skills/goldband"
        [ -d "$runtime_root" ] && [ ! -L "$runtime_root" ] && printf '%s\n' "$version" > "$runtime_root/.installed-version"
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        runtime_root="$HOME/.codex/skills/goldband"
        [ -d "$runtime_root" ] && [ ! -L "$runtime_root" ] && printf '%s\n' "$version" > "$runtime_root/.installed-version"
    fi
}

write_workflow_installed_contracts() {
    local host="$1"
    local repo_dir="$2"
    local fingerprint runtime_root

    fingerprint="$(workflow_contract_fingerprint "$repo_dir")" || return 0

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        runtime_root="$HOME/.claude/skills/goldband"
        write_workflow_installed_contract "$runtime_root" "$fingerprint" "$repo_dir"
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        runtime_root="$HOME/.codex/skills/goldband"
        write_workflow_installed_contract "$runtime_root" "$fingerprint" "$repo_dir"
    fi
}

write_workflow_installed_contract() {
    local runtime_root="$1"
    local fingerprint="$2"
    local repo_dir="$3"

    [ -d "$runtime_root" ] && [ ! -L "$runtime_root" ] || return 0
    printf '%s\n' "$fingerprint" > "$runtime_root/.installed-contract"
    printf '%s\n' "$repo_dir" > "$runtime_root/.installed-source"
}

install_workflow_claude_command_selector() {
    local src="$REPO_DIR/commands/goldband.md"
    local dest="$CLAUDE_DIR/commands/goldband.md"

    [ -f "$src" ] || return 0
    link_component "$src" "$dest" "Goldband workflow selector command"
}

install_workflow_host() {
    local host="$1"
    local profile="${2:-standard}"
    local repo_dir
    local setup_status=0

    case "$profile" in
        full|slim)
            echo -e "${YELLOW}Goldband Loop workflow profile '$profile' 已棄用；改用 standard。${NC}" >&2
            profile="standard"
            ;;
        standard) ;;
        *)
            echo -e "${RED}未知 Goldband Loop workflow profile: $profile${NC}" >&2
            exit 1
            ;;
    esac

    if ! repo_dir="$(resolve_workflow_repo_dir)"; then
        echo -e "${RED}找不到 Goldband Loop runtime。${NC}"
        echo -e "  可設定 ${CYAN}GOLDBAND_LOOP_DIR=/path/to/goldband-loop${NC} 後重試"
        echo -e "  預設會先找 repo 內建的 ${CYAN}$REPO_DIR/goldband-loop${NC}"
        exit 1
    fi

    local version="unknown"
    version="$(read_workflow_version "$repo_dir" 2>/dev/null || echo "unknown")"
    mkdir -p "$HOME/.goldband/projects"
    echo -e "${GREEN}安裝 Goldband Loop runtime (${host}, ${profile} profile)...${NC}"
    echo -e "  repo: ${CYAN}$repo_dir${NC}"
    echo -e "  version: ${CYAN}$version${NC}"
    echo ""

    run_workflow_setup "$repo_dir" "$host" "$profile" || setup_status="$?"
    if [ "$setup_status" -ne 0 ]; then
        exit "$setup_status"
    fi
    verify_installed_work_map_runtime "$host"
    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        install_workflow_claude_command_selector
    fi
    cleanup_workflow_user_entries
    write_workflow_installed_versions "$host" "$version"
    write_workflow_installed_contracts "$host" "$repo_dir"
    if ! is_windows_host; then
        install_shell_launchers
    fi
}

verify_installed_work_map_runtime() {
    local host="$1"
    local runtime_root relative_path
    local roots=()

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        roots+=("$HOME/.claude/skills/goldband")
    fi
    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        roots+=("$HOME/.codex/skills/goldband")
    fi

    for runtime_root in "${roots[@]}"; do
        for relative_path in \
            runtime/workflows/work-map-cli.ts \
            runtime/workflows/work-map.ts \
            runtime/workflows/work-map-store.ts \
            runtime/workflows/work-map-runtime.ts \
            runtime/workflows/types.ts \
            runtime/lib/state-root.ts
        do
            if [ ! -f "$runtime_root/$relative_path" ] || [ -L "$runtime_root/$relative_path" ]; then
                echo -e "${RED}Goldband Work Map runtime 安裝不完整: $runtime_root/$relative_path${NC}" >&2
                exit 1
            fi
        done
        verify_installed_tracker_runtime "$runtime_root"
        for relative_path in \
            bin/goldband-work-verify \
            bin/goldband-work-verify.ts \
            lib/verification-receipt.ts
        do
            if [ ! -f "$runtime_root/$relative_path" ]; then
                echo -e "${RED}Goldband evidence runtime 安裝不完整: $runtime_root/$relative_path${NC}" >&2
                exit 1
            fi
        done
        if [ ! -x "$runtime_root/bin/goldband-work-verify" ]; then
            echo -e "${RED}Goldband verification recorder 不可執行: $runtime_root/bin/goldband-work-verify${NC}" >&2
            exit 1
        fi
    done
}

verify_installed_tracker_runtime() {
    local runtime_root="$1" relative_path
    for relative_path in \
        tracker-config.ts tracker-runtime.ts \
        tracker-adapters/types.ts tracker-adapters/projection.ts tracker-adapters/sync-state.ts \
        tracker-adapters/import.ts tracker-adapters/cli-adapter.ts \
        tracker-adapters/github.ts tracker-adapters/gitlab.ts
    do
        if [ ! -f "$runtime_root/runtime/workflows/$relative_path" ] || [ -L "$runtime_root/runtime/workflows/$relative_path" ]; then
            echo -e "${RED}Goldband tracker runtime 安裝不完整: $runtime_root/runtime/workflows/$relative_path${NC}" >&2
            exit 1
        fi
    done
}

run_workflow_setup() {
    local repo_dir="$1"
    local host="$2"
    local profile="$3"
    local setup_status
    local errexit_was_set=0

    case "$-" in
        *e*) errexit_was_set=1 ;;
    esac
    set +e
    (
        cd "$repo_dir" || {
            echo "  [錯誤] 無法進入 Goldband Loop runtime: $repo_dir"
            exit 1
        }
        GOLDBAND_HOME="$HOME/.goldband" ./setup --host "$host" --profile "$profile" --quiet 2>&1
    )
    setup_status=${PIPESTATUS[0]}
    if [ "$errexit_was_set" -eq 1 ]; then
        set -e
    else
        set +e
    fi
    return "$setup_status"
}
