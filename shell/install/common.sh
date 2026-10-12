# This file must be sourced by bash, not executed directly.

backup_host_config() {
    local dest="$1"
    [ -e "$dest" ] || [ -L "$dest" ] || return 0
    if [ -d "${dest}.bak" ] || [ -d "${dest}.bak.previous" ]; then
        echo "[錯誤] Config backup path is a directory: $dest" >&2
        return 1
    fi
    local tmp
    tmp="$(mktemp "${dest}.bak.tmp.XXXXXX")" || return 1
    if ! cp -p "$dest" "$tmp"; then rm -f "$tmp"; return 1; fi
    if [ -e "${dest}.bak" ] || [ -L "${dest}.bak" ]; then
        mv -f "${dest}.bak" "${dest}.bak.previous" || { rm -f "$tmp"; return 1; }
    fi
    mv -f "$tmp" "${dest}.bak" || { rm -f "$tmp"; return 1; }
    echo "  [備份] $dest -> ${dest}.bak (previous backup: .bak.previous)"
}

replace_host_config() {
    local dest="$1"
    local tmp="$2"
    if [ ! -L "$dest" ] && cmp -s "$dest" "$tmp"; then
        rm -f "$tmp"
        return 0
    fi
    backup_host_config "$dest" || { rm -f "$tmp"; return 1; }
    mv -f "$tmp" "$dest" || { rm -f "$tmp"; return 1; }
}

link_component() {
    local src="$1"
    local dest="$2"
    local name="$3"

    if [ ! -e "$src" ]; then
        echo -e "  ${YELLOW}[跳過] $name — 來源不存在${NC}"
        return
    fi

    if repo_path_installed_from "$src" "$dest"; then
        if [ -L "$dest" ]; then
            echo -e "  ${GREEN}[已安裝] $name${NC}"
        else
            echo -e "  ${GREEN}[已安裝 (copy fallback)] $name${NC}"
        fi
        return
    fi

    if [ -L "$dest" ]; then
        rm "$dest"
    elif [ -e "$dest" ]; then
        echo -e "  ${YELLOW}[備份] $name — 備份現有到 ${dest}.bak${NC}"
        mv "$dest" "${dest}.bak" || return 1
    fi

    mkdir -p "$(dirname "$dest")" || return 1
    create_repo_link "$src" "$dest" || return 1
    if [ "$CREATE_REPO_LINK_MODE" = "copy" ]; then
        echo -e "  ${YELLOW}[安裝 (copy fallback)] $name — 此環境無法建立檔案 symlink${NC}"
    else
        echo -e "  ${GREEN}[安裝 (repo-linked)] $name${NC}"
    fi
}

create_repo_link() {
    local src="$1"
    local dest="$2"
    CREATE_REPO_LINK_MODE=""

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        rm -rf "$dest" || return 1
    fi

    ln -s "$src" "$dest" 2>/dev/null || true
    if repo_link_points_to "$dest" "$src"; then
        CREATE_REPO_LINK_MODE="link"
        return 0
    fi

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        rm -rf "$dest" || return 1
    fi

    if [ -d "$src" ] && create_windows_directory_junction "$src" "$dest"; then
        if repo_link_points_to "$dest" "$src"; then
            CREATE_REPO_LINK_MODE="link"
            return 0
        fi
        rm -rf "$dest" || return 1
    fi

    if [ -d "$src" ]; then
        cp -R "$src" "$dest" || return 1
    else
        cp "$src" "$dest" || return 1
    fi
    CREATE_REPO_LINK_MODE="copy"
}

materialize_file_copy() {
    local src="$1"
    local dest="$2"
    local tmp="${dest}.tmp.$$"

    [ -f "$src" ] || return 1
    mkdir -p "$(dirname "$dest")" || return 1
    rm -f "$tmp" || return 1
    cp "$src" "$tmp" || return 1
    mv -f "$tmp" "$dest"
}

repo_link_points_to() {
    local link_path="$1"
    local expected_target="$2"

    [ -L "$link_path" ] || return 1
    [ "$(readlink "$link_path")" = "$expected_target" ]
}

repo_path_installed_from() {
    local src="$1"
    local dest="$2"

    repo_link_points_to "$dest" "$src" && return 0
    [ -f "$src" ] && [ -f "$dest" ] && cmp -s "$src" "$dest" 2>/dev/null && return 0
    [ -d "$src" ] && [ -d "$dest" ] && diff -qr "$src" "$dest" >/dev/null 2>&1
}

create_windows_directory_junction() {
    local src="$1"
    local dest="$2"

    command -v cygpath >/dev/null 2>&1 || return 1
    command -v cmd >/dev/null 2>&1 || return 1

    local win_src
    local win_dest
    win_src="$(cygpath -w "$src")" || return 1
    win_dest="$(cygpath -w "$dest")" || return 1

    cmd //c mklink //J "$win_dest" "$win_src" >/dev/null 2>&1
}

normalize_path_for_compare() {
    local path_value="$1"

    if command -v cygpath >/dev/null 2>&1; then
        cygpath -m "$path_value" 2>/dev/null && return 0
    fi
    printf '%s\n' "$path_value"
}

paths_equivalent() {
    local left="$1"
    local right="$2"

    [ "$left" = "$right" ] && return 0
    [ "$(normalize_path_for_compare "$left")" = "$(normalize_path_for_compare "$right")" ]
}

timestamp_suffix() {
    date +"%Y%m%d%H%M%S"
}

join_by_comma() {
    local IFS=","
    echo "$*"
}

is_windows_host() {
    [ "${GOLDBAND_TEST_WINDOWS_HOST:-0}" = "1" ] && return 0
    case "$(uname -s 2>/dev/null || true)" in
        MINGW*|MSYS*|CYGWIN*) return 0 ;;
        *) return 1 ;;
    esac
}

dedupe_skill_list() {
    local seen=" "
    local output=()
    for skill in "$@"; do
        if [[ "$seen" != *" $skill "* ]]; then
            output+=("$skill")
            seen+=" $skill "
        fi
    done
    if [ "${#output[@]}" -gt 0 ]; then
        printf '%s\n' "${output[@]}"
    fi
}

read_profile_value() {
    local profile_file="$1"
    local key="$2"

    if [ ! -f "$profile_file" ]; then
        return 1
    fi

    local line
    line=$(grep "^${key}=" "$profile_file" 2>/dev/null || true)
    [ -n "$line" ] || return 1
    printf '%s\n' "${line#*=}"
}

profile_rank() {
    case "$1" in
        core) echo 1 ;;
        dev) echo 2 ;;
        full) echo 3 ;;
        *) echo 0 ;;
    esac
}

build_skill_catalog_list() {
    local tool="$1"
    local profile="$2"
    local requested_rank
    requested_rank="$(profile_rank "$profile")"
    [ "$requested_rank" -gt 0 ] || return 1

    local field_index
    case "$tool" in
        claude) field_index=2 ;;
        codex) field_index=3 ;;
        *) return 1 ;;
    esac

    skill_catalog | awk -F'|' -v field="$field_index" -v requested="$requested_rank" '
        function rank(value) {
            if (value == "core") return 1;
            if (value == "dev") return 2;
            if (value == "full") return 3;
            return 0;
        }
        {
            tier = $field;
            if (rank(tier) > 0 && rank(tier) <= requested) {
                print $1;
            }
        }
    '
}

build_skill_profile_list() {
    build_skill_catalog_list "claude" "$1"
}

build_managed_skill_profile_list() {
    local tool="$1"
    local profile="$2"

    case "$tool" in
        claude)
            build_skill_profile_list "$profile"
            ;;
        codex)
            build_codex_skill_profile_list "$profile"
            ;;
        *)
            return 1
            ;;
    esac
}

read_installed_managed_skill_list() {
    local target_dir="$1"
    local __resultvar="$2"
    eval "$__resultvar=()"

    [ -d "$target_dir" ] || return 0

    local entry
    for entry in "$target_dir"/*; do
        if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
            continue
        fi
        if ! is_repo_skill_link "$entry"; then
            continue
        fi

        local name
        name=$(basename "$entry")
        if ! is_safe_managed_entry_name "$name"; then
            continue
        fi
        eval "$__resultvar+=(\"\$name\")"
    done
}

skill_list_is_subset_of() {
    local installed_list_name="$1"
    local expected_list_name="$2"

    eval "local installed=(\"\${${installed_list_name}[@]}\")"
    eval "local expected=(\"\${${expected_list_name}[@]}\")"

    [ "${#installed[@]}" -eq 0 ] && return 0
    [ "${#expected[@]}" -eq 0 ] && return 1

    local skill expected_skill found
    for skill in "${installed[@]}"; do
        found=1
        for expected_skill in "${expected[@]}"; do
            if [ "$skill" = "$expected_skill" ]; then
                found=0
                break
            fi
        done
        if [ "$found" -ne 0 ]; then
            return 1
        fi
    done

    return 0
}

skill_lists_equal() {
    local left_name="$1"
    local right_name="$2"

    eval "local left=(\"\${${left_name}[@]}\")"
    eval "local right=(\"\${${right_name}[@]}\")"

    [ "${#left[@]}" -eq "${#right[@]}" ] || return 1
    skill_list_is_subset_of "$left_name" "$right_name"
}

infer_managed_skill_profile() {
    local tool="$1"
    local target_dir="$2"

    local installed_skills=()
    read_installed_managed_skill_list "$target_dir" installed_skills
    [ "${#installed_skills[@]}" -gt 0 ] || return 1

    local profile expected_skills
    for profile in core dev full; do
        expected_skills=()
        while IFS= read -r skill; do
            [ -n "$skill" ] && expected_skills+=("$skill")
        done < <(build_managed_skill_profile_list "$tool" "$profile")

        if skill_lists_equal installed_skills expected_skills; then
            printf '%s\n' "$profile"
            return 0
        fi
    done

    for profile in core dev full; do
        expected_skills=()
        while IFS= read -r skill; do
            [ -n "$skill" ] && expected_skills+=("$skill")
        done < <(build_managed_skill_profile_list "$tool" "$profile")

        if skill_list_is_subset_of installed_skills expected_skills; then
            printf '%s\n' "$profile"
            return 0
        fi
    done

    return 1
}

is_repo_skill_link_under() {
    local link_path="$1"
    local source_root="$2"
    if [ ! -L "$link_path" ]; then
        return 1
    fi
    local target
    target=$(readlink "$link_path")
    case "$target" in
        "$source_root"/*|"$source_root")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_repo_skill_link() {
    is_repo_skill_link_under "$1" "$REPO_DIR/skills/global"
}

backup_existing_path() {
    local path="$1"
    local backup_path="${path}.bak.$(timestamp_suffix)"
    mv "$path" "$backup_path"
    echo -e "  ${YELLOW}[備份] $(basename "$path") -> $backup_path${NC}"
}

backup_or_remove_existing_path() {
    local path="$1"
    [ -e "$path" ] || [ -L "$path" ] || return 0
    backup_existing_path "$path"
}

prepare_skills_directory() {
    if [ -L "$SKILLS_DIR" ]; then
        local current_target
        current_target=$(readlink "$SKILLS_DIR")
        if [ "$current_target" = "$REPO_DIR/skills/global" ]; then
            rm "$SKILLS_DIR"
        else
            backup_existing_path "$SKILLS_DIR"
        fi
    elif [ -e "$SKILLS_DIR" ] && [ ! -d "$SKILLS_DIR" ]; then
        backup_existing_path "$SKILLS_DIR"
    fi

    mkdir -p "$SKILLS_DIR"
}

cleanup_managed_skill_links() {
    cleanup_managed_profile_entries "$SKILLS_DIR" "$SKILL_PROFILE_FILE" "README.md" "skill-rules.json"
}

link_skill_entry() {
    local source="$1"
    local dest="$2"

    if [ -L "$dest" ]; then
        rm "$dest" || return 1
    elif [ -e "$dest" ]; then
        backup_existing_path "$dest" || return 1
    fi

    create_repo_link "$source" "$dest" || return 1
}

write_skill_profile_file() {
    local profile="$1"
    shift
    local skills_csv
    skills_csv=$(join_by_comma "$@")

    {
        echo "profile=$profile"
        echo "installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        echo "skills=$skills_csv"
    } > "$SKILL_PROFILE_FILE"
}

install_skills_profile() {
    local profile="$1"
    shift
    local selected_skills=("$@")
    local install_args=(
        "$SKILLS_DIR"
        "$SKILL_PROFILE_FILE"
        "$profile"
        "全域 Skills Profile"
        "skill"
        "write_skill_profile_file"
        "$REPO_DIR/skills/global/README.md:README.md"
        "$REPO_DIR/skills/global/skill-rules.json:skill-rules.json"
        --
    )

    prepare_skills_directory
    if [ "${#selected_skills[@]}" -gt 0 ]; then
        install_args+=("${selected_skills[@]}")
    fi
    install_managed_skill_profile "${install_args[@]}"
}

build_codex_skill_profile_list() {
    build_skill_catalog_list "codex" "$1"
}

prepare_codex_skills_directory() {
    if [ -L "$CODEX_SKILLS_DIR" ]; then
        backup_existing_path "$CODEX_SKILLS_DIR"
    elif [ -e "$CODEX_SKILLS_DIR" ] && [ ! -d "$CODEX_SKILLS_DIR" ]; then
        backup_existing_path "$CODEX_SKILLS_DIR"
    fi

    mkdir -p "$CODEX_SKILLS_DIR"
}

cleanup_managed_codex_skill_links() {
    cleanup_managed_profile_entries "$CODEX_SKILLS_DIR" "$CODEX_SKILL_PROFILE_FILE"
}
