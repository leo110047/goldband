# This file must be sourced by bash, not executed directly.
#
# Git style gate lifecycle: materialized global hooks, the shell startup block
# that forces them ahead of repository-local core.hooksPath, status, and
# uninstall.

STYLE_GATE_SHELL_BLOCK="git hooks"

# Client-side hooks installed only to chain to the preserved global hook and the
# repository's own hook. push-to-checkout is excluded because its presence
# replaces Git's built-in updateInstead safety check.
STYLE_GATE_CHAINED_HOOKS=(
    applypatch-msg pre-applypatch post-applypatch pre-merge-commit
    prepare-commit-msg post-commit pre-rebase post-checkout post-merge
    pre-push post-rewrite pre-auto-gc sendemail-validate
)

style_gate_managed_files() {
    printf '%s\n' pre-commit commit-msg lib/project-hook.sh lib/git-config-env.sh
    printf '%s\n' "${STYLE_GATE_CHAINED_HOOKS[@]}"
}

style_gate_source_for() {
    case "$1" in
        pre-commit | commit-msg | lib/*) printf '%s\n' "$GIT_HOOKS_SOURCE_DIR/$1" ;;
        *) printf '%s\n' "$GIT_HOOKS_SOURCE_DIR/lib/chain-hook" ;;
    esac
}

style_gate_is_chained_hook() {
    local name
    for name in "${STYLE_GATE_CHAINED_HOOKS[@]}"; do
        [ "$name" = "$1" ] && return 0
    done
    return 1
}

install_style_gate() {
    if [ ! -d "$GIT_HOOKS_SOURCE_DIR" ]; then
        echo -e "  ${YELLOW}[跳過] Git style gate — 來源不存在${NC}"
        return
    fi
    if ! command -v git >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[跳過] Git style gate — git 不可用${NC}"
        return
    fi

    local current_hooks_path
    current_hooks_path="$(git config --global --get core.hooksPath 2>/dev/null || true)"
    if [ -n "$current_hooks_path" ] \
        && ! paths_equivalent "$current_hooks_path" "$GIT_HOOKS_DIR" \
        && ! paths_equivalent "$current_hooks_path" "$LEGACY_GIT_HOOKS_DIR"; then
        echo -e "  ${YELLOW}[保留] global core.hooksPath 已設定為 $current_hooks_path${NC}"
        echo -e "  ${CYAN}  若要啟用 goldband style gate，請先確認既有 hook 後手動設定:${NC}"
        echo -e "  ${CYAN}  git config --global core.hooksPath \"$GIT_HOOKS_DIR\"${NC}"
        return
    fi

    if paths_equivalent "$current_hooks_path" "$LEGACY_GIT_HOOKS_DIR"; then
        migrate_legacy_hook_files
    fi
    materialize_style_gate_hooks || return 1
    git config --global core.hooksPath "$GIT_HOOKS_DIR"
    if paths_equivalent "$current_hooks_path" "$LEGACY_GIT_HOOKS_DIR"; then
        echo -e "  ${GREEN}[遷移] Git style gate source checkout -> $GIT_HOOKS_DIR${NC}"
    else
        echo -e "  ${GREEN}[安裝] Git style gate -> global core.hooksPath=$GIT_HOOKS_DIR${NC}"
    fi
    upsert_marked_block "$ZSHENV_FILE" "$STYLE_GATE_SHELL_BLOCK" style_gate_shell_block || return 1
    echo -e "  ${GREEN}[安裝] Git hooks 環境覆寫 -> ${ZSHENV_FILE}（新開的 shell 生效）${NC}"
    install_goldband_project_style_gate
}

style_gate_shell_block() {
    local env_file
    env_file="$(shell_single_quote "$GIT_HOOKS_DIR/lib/git-config-env.sh")"
    echo "# >>> goldband $STYLE_GATE_SHELL_BLOCK >>>"
    echo "if [ -f $env_file ]; then"
    echo "    . $env_file $(shell_single_quote "$GIT_HOOKS_DIR")"
    echo "fi"
    echo "# <<< goldband $STYLE_GATE_SHELL_BLOCK <<<"
}

shell_single_quote() {
    local quote="'"
    printf "'%s'" "${1//$quote/$quote\\$quote$quote}"
}

migrate_legacy_hook_files() {
    local source name destination
    for source in "$LEGACY_GIT_HOOKS_DIR"/*; do
        [ -f "$source" ] || continue
        name="$(basename "$source")"
        case "$name" in
            pre-commit|commit-msg) continue ;;
        esac
        destination="$GIT_HOOKS_DIR/$name"
        if [ -e "$destination" ]; then
            if ! cmp -s "$source" "$destination" 2>/dev/null; then
                echo -e "  ${YELLOW}[保留] 既有 installed hook 與 legacy hook 不同: $destination${NC}"
            fi
            continue
        fi
        materialize_file_copy "$source" "$destination" || return 1
        chmod +x "$destination"
        echo -e "  ${GREEN}[遷移] 保留既有 hook: $name${NC}"
    done
}

# Prints the recorded "<checksum> <bytes>" of a file the previous install owns.
style_gate_recorded_identity() {
    local marker="$GIT_HOOKS_DIR/.goldband-source"
    local kind relative checksum bytes extra
    [ -f "$marker" ] || return 1
    while IFS=$'\t' read -r kind relative checksum bytes extra; do
        if [ "$kind" = "file" ] && [ "$relative" = "$1" ]; then
            printf '%s %s\n' "$checksum" "$bytes"
            return 0
        fi
    done < <(sed -n '3,$p' "$marker")
    return 1
}

style_gate_file_is_owned() {
    local target="$GIT_HOOKS_DIR/$1"
    local recorded checksum bytes ignored
    recorded="$(style_gate_recorded_identity "$1")" || return 1
    [ -f "$target" ] && [ ! -L "$target" ] || return 1
    IFS=' ' read -r checksum bytes ignored < <(cksum "$target")
    [ "$recorded" = "$checksum $bytes" ]
}

# A foreign hook under a chained name moves to <name>.local, which the goldband
# hook runs before the repository hook. Fails when <name>.local is taken.
preserve_foreign_hook() {
    local name="$1"
    local target="$GIT_HOOKS_DIR/$name"
    [ -e "$target" ] || [ -L "$target" ] || return 0
    style_gate_file_is_owned "$name" && return 0
    if [ -e "$target.local" ] || [ -L "$target.local" ]; then
        echo -e "  ${YELLOW}[保留] $target 與 $target.local 都已存在，不安裝 goldband $name hook${NC}"
        return 1
    fi
    mv "$target" "$target.local"
    echo -e "  ${GREEN}[保留] 既有 hook $name -> $name.local，由 goldband 串接${NC}"
}

materialize_style_gate_hooks() {
    local relative source destination marker_tmp checksum bytes ignored
    local -a installed=()
    while IFS= read -r relative; do
        source="$(style_gate_source_for "$relative")"
        destination="$GIT_HOOKS_DIR/$relative"
        if [ ! -f "$source" ]; then
            echo -e "  ${RED}[失敗] Git style gate 缺少來源: $source${NC}" >&2
            return 1
        fi
        if style_gate_is_chained_hook "$relative"; then
            preserve_foreign_hook "$relative" || continue
        fi
        materialize_file_copy "$source" "$destination" || return 1
        case "$relative" in
            lib/project-hook.sh | lib/git-config-env.sh) ;;
            *) chmod +x "$destination" ;;
        esac
        installed+=("$relative")
    done < <(style_gate_managed_files)
    marker_tmp="$GIT_HOOKS_DIR/.goldband-source.tmp.$$"
    {
        printf '%s\n' "$REPO_DIR"
        printf 'schemaVersion=2\n'
        for relative in "${installed[@]}"; do
            IFS=' ' read -r checksum bytes ignored < <(cksum "$GIT_HOOKS_DIR/$relative")
            printf 'file\t%s\t%s\t%s\n' "$relative" "$checksum" "$bytes"
        done
    } > "$marker_tmp"
    mv -f "$marker_tmp" "$GIT_HOOKS_DIR/.goldband-source"
}

install_goldband_project_style_gate() {
    local project_gate="$REPO_DIR/scripts/check-goldband-project-style-gate.mjs"
    if [ ! -f "$project_gate" ]; then
        return
    fi

    local common_dir
    common_dir="$(git -C "$REPO_DIR" rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -z "$common_dir" ]; then
        return
    fi
    case "$common_dir" in
        /*) ;;
        *) common_dir="$REPO_DIR/$common_dir" ;;
    esac

    local hook_path="$common_dir/hooks/pre-commit"
    local marker="scripts/check-goldband-project-style-gate.mjs --staged"
    if [ -f "$hook_path" ] && grep -q "$marker" "$hook_path"; then
        chmod +x "$hook_path" 2>/dev/null || true
        echo -e "  ${GREEN}[已安裝] goldband repo project style gate${NC}"
        return
    fi
    if [ -e "$hook_path" ] || [ -L "$hook_path" ]; then
        backup_existing_path "$hook_path"
    fi

    mkdir -p "$(dirname "$hook_path")"
    local tmp="${hook_path}.tmp.$$"
    {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo ''
        echo 'node scripts/check-goldband-project-style-gate.mjs --staged'
    } > "$tmp"
    mv -f "$tmp" "$hook_path"
    chmod +x "$hook_path"
    echo -e "  ${GREEN}[安裝] goldband repo project style gate -> $hook_path${NC}"
}

show_git_style_gate_status() {
    if ! command -v git >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[無法檢查]${NC} git 不可用"
        return
    fi
    local current_hooks_path
    current_hooks_path="$(git config --global --get core.hooksPath 2>/dev/null || true)"
    if paths_equivalent "$current_hooks_path" "$GIT_HOOKS_DIR"; then
        if style_gate_runtime_matches_source; then
            echo -e "  ${GREEN}[OK]${NC} global core.hooksPath -> $GIT_HOOKS_DIR"
        else
            echo -e "  ${YELLOW}[stale]${NC} Git style gate runtime 與目前 repo 不一致；請執行 ./install.sh style-gate"
        fi
        show_style_gate_override_status
    elif paths_equivalent "$current_hooks_path" "$LEGACY_GIT_HOOKS_DIR"; then
        echo -e "  ${YELLOW}[stale]${NC} global core.hooksPath 仍指向 source checkout；請執行 ./install.sh style-gate"
    elif [ -n "$current_hooks_path" ]; then
        echo -e "  ${YELLOW}[外部設定]${NC} global core.hooksPath -> $current_hooks_path"
    else
        echo -e "  ${RED}[未安裝]${NC} global core.hooksPath 未設定"
    fi
}

show_style_gate_override_status() {
    local preserved=() name
    if marked_block_installed "$ZSHENV_FILE" "$STYLE_GATE_SHELL_BLOCK"; then
        echo -e "  ${GREEN}[OK]${NC} repo-local core.hooksPath 覆寫 -> $ZSHENV_FILE"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} repo-local core.hooksPath 會略過 goldband；請執行 ./install.sh style-gate"
    fi
    for name in "${STYLE_GATE_CHAINED_HOOKS[@]}"; do
        [ -e "$GIT_HOOKS_DIR/$name.local" ] && preserved+=("$name.local")
    done
    if [ "${#preserved[@]}" -gt 0 ]; then
        echo -e "  ${CYAN}[串接]${NC} 保留的全域 hook: ${preserved[*]}"
    fi
}

style_gate_runtime_matches_source() {
    local marker="$GIT_HOOKS_DIR/.goldband-source"
    local relative
    [ -f "$marker" ] || return 1
    [ "$(sed -n '1p' "$marker")" = "$REPO_DIR" ] || return 1
    [ "$(sed -n '2p' "$marker")" = "schemaVersion=2" ] || return 1
    while IFS= read -r relative; do
        # A chained hook left out because <name> and <name>.local both exist.
        if style_gate_is_chained_hook "$relative" \
            && ! style_gate_recorded_identity "$relative" >/dev/null; then
            continue
        fi
        cmp -s "$(style_gate_source_for "$relative")" "$GIT_HOOKS_DIR/$relative" 2>/dev/null || return 1
    done < <(style_gate_managed_files)
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
    if marked_block_installed "$ZSHENV_FILE" "$STYLE_GATE_SHELL_BLOCK"; then
        remove_marked_block "$ZSHENV_FILE" "$STYLE_GATE_SHELL_BLOCK"
        echo -e "  ${GREEN}[移除] Git hooks 環境覆寫 -> $ZSHENV_FILE${NC}"
    fi
    if [ "$installed_runtime_owned" = true ]; then
        remove_installed_style_gate_hooks
    fi
}

installed_style_gate_runtime_is_owned() {
    local marker="$GIT_HOOKS_DIR/.goldband-source"
    local kind relative checksum bytes extra allowed seen=" "
    [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
    case "$(sed -n '2p' "$marker")" in
        schemaVersion=1 | schemaVersion=2) ;;
        *) return 1 ;;
    esac
    allowed=" $(style_gate_managed_files | tr '\n' ' ')"
    while IFS=$'\t' read -r kind relative checksum bytes extra; do
        [ "$kind" = "file" ] || return 1
        [ -n "$checksum" ] && [[ "$checksum" =~ ^[0-9]+$ ]] || return 1
        [ -n "$bytes" ] && [[ "$bytes" =~ ^[0-9]+$ ]] || return 1
        [ -z "$extra" ] || return 1
        [[ "$allowed" == *" $relative "* ]] || return 1
        [[ "$seen" != *" $relative "* ]] || return 1
        seen="$seen$relative "
    done < <(sed -n '3,$p' "$marker")
    [[ "$seen" == *" pre-commit "* ]] \
        && [[ "$seen" == *" commit-msg "* ]] \
        && [[ "$seen" == *" lib/project-hook.sh "* ]]
}

remove_installed_style_gate_hooks() {
    local marker="$GIT_HOOKS_DIR/.goldband-source"
    local kind relative checksum bytes extra name
    while IFS=$'\t' read -r kind relative checksum bytes extra; do
        remove_owned_style_gate_file "$relative" "$checksum" "$bytes"
    done < <(sed -n '3,$p' "$marker")
    rm -f "$marker"
    for name in "${STYLE_GATE_CHAINED_HOOKS[@]}"; do
        if [ -e "$GIT_HOOKS_DIR/$name.local" ] && [ ! -e "$GIT_HOOKS_DIR/$name" ]; then
            mv "$GIT_HOOKS_DIR/$name.local" "$GIT_HOOKS_DIR/$name"
            echo -e "  ${GREEN}[還原] 保留的 hook $name.local -> $name${NC}"
        fi
    done
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
