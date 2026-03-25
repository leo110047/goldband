# This file must be sourced by bash, not executed directly.

link_component() {
    local src="$1"
    local dest="$2"
    local name="$3"

    if [ ! -e "$src" ]; then
        echo -e "  ${YELLOW}[跳過] $name — 來源不存在${NC}"
        return
    fi

    if [ -L "$dest" ]; then
        local current_target
        current_target=$(readlink "$dest")
        if [ "$current_target" = "$src" ]; then
            echo -e "  ${GREEN}[已安裝] $name${NC}"
            return
        fi
        rm "$dest"
    elif [ -e "$dest" ]; then
        echo -e "  ${YELLOW}[備份] $name — 備份現有到 ${dest}.bak${NC}"
        mv "$dest" "${dest}.bak"
    fi

    mkdir -p "$(dirname "$dest")"
    ln -s "$src" "$dest"
    echo -e "  ${GREEN}[安裝 (repo-linked)] $name${NC}"
}

timestamp_suffix() {
    date +"%Y%m%d%H%M%S"
}

join_by_comma() {
    local IFS=","
    echo "$*"
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
    printf '%s\n' "${output[@]}"
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
        rm "$dest"
    elif [ -e "$dest" ]; then
        backup_existing_path "$dest"
    fi

    ln -s "$source" "$dest"
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

    prepare_skills_directory
    install_managed_skill_profile \
        "$SKILLS_DIR" \
        "$SKILL_PROFILE_FILE" \
        "$profile" \
        "全域 Skills Profile" \
        "skill" \
        "write_skill_profile_file" \
        "$REPO_DIR/skills/global/README.md:README.md" \
        "$REPO_DIR/skills/global/skill-rules.json:skill-rules.json" \
        -- \
        "${selected_skills[@]}"
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

is_safe_managed_entry_name() {
    local entry_name="$1"
    case "$entry_name" in
        ""|.|..|*/*|*[!A-Za-z0-9._-]*)
            return 1
            ;;
        *)
            return 0
            ;;
    esac
}

read_profile_skill_array() {
    local skills_csv="$1"
    local __resultvar="$2"
    local skill_array=()

    IFS=',' read -r -a skill_array <<< "$skills_csv"
    eval "$__resultvar=()"

    local skill
    for skill in "${skill_array[@]}"; do
        [ -z "$skill" ] && continue
        if ! is_safe_managed_entry_name "$skill"; then
            echo "invalid managed entry name: $skill" >&2
            continue
        fi
        eval "$__resultvar+=(\"\$skill\")"
    done
}

write_codex_skill_profile_file() {
    local profile="$1"
    shift
    local skills_csv
    skills_csv=$(join_by_comma "$@")

    {
        echo "profile=$profile"
        echo "installed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
        echo "skills=$skills_csv"
    } > "$CODEX_SKILL_PROFILE_FILE"
}

install_codex_skills_profile() {
    local profile="$1"
    shift
    local selected_skills=("$@")

    prepare_codex_skills_directory
    install_managed_skill_profile \
        "$CODEX_SKILLS_DIR" \
        "$CODEX_SKILL_PROFILE_FILE" \
        "$profile" \
        "Codex Skills Profile" \
        "Codex skill" \
        "write_codex_skill_profile_file" \
        -- \
        "${selected_skills[@]}"
}

cleanup_managed_profile_entries() {
    local target_dir="$1"
    local profile_file="$2"
    shift 2
    local extra_entries=("$@")

    if [ ! -d "$target_dir" ]; then
        return
    fi

    if [ -f "$profile_file" ]; then
        local skills_line
        skills_line=$(grep '^skills=' "$profile_file" 2>/dev/null || true)
        local skills_csv="${skills_line#skills=}"
        local skill
        local skill_array=()
        read_profile_skill_array "$skills_csv" skill_array
        for skill in "${skill_array[@]}"; do
            rm -rf "${target_dir:?}/$skill"
        done
        local entry
        for entry in "${extra_entries[@]}"; do
            [ -z "$entry" ] && continue
            rm -rf "${target_dir:?}/$entry"
        done
    else
        local entry
        for entry in "$target_dir"/* "$target_dir"/.*; do
            if [ ! -e "$entry" ] && [ ! -L "$entry" ]; then
                continue
            fi
            local name
            name=$(basename "$entry")
            if [ "$name" = "." ] || [ "$name" = ".." ] || [ "$name" = ".goldband-profile" ]; then
                continue
            fi
            if is_repo_skill_link "$entry"; then
                rm "$entry"
            fi
        done
    fi

    rm -f "$profile_file"
}

install_managed_skill_profile() {
    local target_dir="$1"
    local profile_file="$2"
    local profile="$3"
    local label="$4"
    local missing_label="$5"
    local profile_writer="$6"
    shift 6

    local extra_links=()
    while [ $# -gt 0 ]; do
        if [ "$1" = "--" ]; then
            shift
            break
        fi
        extra_links+=("$1")
        shift
    done
    local selected_skills=("$@")

    cleanup_managed_profile_entries "$target_dir" "$profile_file"

    local installed=0
    local skill
    for skill in "${selected_skills[@]}"; do
        local src="$REPO_DIR/skills/global/$skill"
        local dest="$target_dir/$skill"

        if [ ! -d "$src" ]; then
            echo -e "  ${YELLOW}[跳過] ${missing_label} 不存在: $skill${NC}"
            continue
        fi

        link_skill_entry "$src" "$dest"
        installed=$((installed + 1))
    done

    local link_spec
    for link_spec in "${extra_links[@]}"; do
        local extra_src="${link_spec%%:*}"
        local extra_dest_name="${link_spec##*:}"
        link_skill_entry "$extra_src" "$target_dir/$extra_dest_name"
    done

    "$profile_writer" "$profile" "${selected_skills[@]}"

    echo -e "  ${GREEN}[安裝] ${label}: $profile (${installed} 個)${NC}"
}
