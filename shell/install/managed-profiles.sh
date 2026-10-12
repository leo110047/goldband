# This file must be sourced by bash, not executed directly.

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
    if [ "${#skill_array[@]}" -gt 0 ]; then
        for skill in "${skill_array[@]}"; do
            [ -z "$skill" ] && continue
            if ! is_safe_managed_entry_name "$skill"; then
                echo "invalid managed entry name: $skill" >&2
                continue
            fi
            eval "$__resultvar+=(\"\$skill\")"
        done
    fi
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
    local install_args=(
        "$CODEX_SKILLS_DIR"
        "$CODEX_SKILL_PROFILE_FILE"
        "$profile"
        "Codex Skills Profile"
        "Codex skill"
        "write_codex_skill_profile_file"
        --
    )

    prepare_codex_skills_directory || return 1
    if [ "${#selected_skills[@]}" -gt 0 ]; then
        install_args+=("${selected_skills[@]}")
    fi
    install_managed_skill_profile "${install_args[@]}"
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
        if [ "${#skill_array[@]}" -gt 0 ]; then
            for skill in "${skill_array[@]}"; do
                rm -rf "${target_dir:?}/$skill"
            done
        fi
        local entry
        if [ "${#extra_entries[@]}" -gt 0 ]; then
            for entry in "${extra_entries[@]}"; do
                [ -z "$entry" ] && continue
                rm -rf "${target_dir:?}/$entry"
            done
        fi
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

    cleanup_managed_profile_entries "$target_dir" "$profile_file" || return 1

    local installed=0
    if [ "${#selected_skills[@]}" -gt 0 ]; then
        install_selected_profile_skills "$target_dir" "$missing_label" "${selected_skills[@]}" || return 1
        installed="$SELECTED_PROFILE_SKILLS_INSTALLED"
    else
        SELECTED_PROFILE_SKILLS_INSTALLED=0
    fi
    if [ "${#extra_links[@]}" -gt 0 ]; then
        install_profile_extra_links "$target_dir" "${extra_links[@]}" || return 1
    fi

    if [ "${#selected_skills[@]}" -gt 0 ]; then
        "$profile_writer" "$profile" "${selected_skills[@]}" || return 1
    else
        "$profile_writer" "$profile" || return 1
    fi

    echo -e "  ${GREEN}[安裝] ${label}: $profile (${installed} 個)${NC}"
}

install_selected_profile_skills() {
    local target_dir="$1"
    local missing_label="$2"
    shift 2
    local installed=0
    local skill
    for skill in "$@"; do
        local src="$REPO_DIR/skills/global/$skill"
        local dest="$target_dir/$skill"
        if [ ! -d "$src" ]; then
            echo -e "  ${YELLOW}[跳過] ${missing_label} 不存在: $skill${NC}" >&2
            continue
        fi
        link_skill_entry "$src" "$dest" || return 1
        installed=$((installed + 1))
    done
    SELECTED_PROFILE_SKILLS_INSTALLED="$installed"
}

install_profile_extra_links() {
    local target_dir="$1"
    shift
    local link_spec
    for link_spec in "$@"; do
        local extra_src="${link_spec%%:*}"
        local extra_dest_name="${link_spec##*:}"
        link_skill_entry "$extra_src" "$target_dir/$extra_dest_name" || return 1
    done
}

managed_profile_needs_sync() {
    local tool="$1"
    local target_dir="$2"
    local profile_file="$3"
    local profile="$4"
    shift 4
    local extra_links=("$@")

    [ -d "$target_dir" ] || return 0

    local desired_skills=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && desired_skills+=("$skill")
    done < <(build_managed_skill_profile_list "$tool" "$profile")

    local desired_csv
    if [ "${#desired_skills[@]}" -gt 0 ]; then
        desired_csv=$(join_by_comma "${desired_skills[@]}")
    else
        desired_csv=""
    fi
    local current_csv
    current_csv=$(read_profile_value "$profile_file" "skills" 2>/dev/null || true)

    [ "$desired_csv" = "$current_csv" ] || return 0

    if [ "${#desired_skills[@]}" -gt 0 ]; then
        managed_profile_skills_synced "$target_dir" "${desired_skills[@]}" || return 0
    fi
    if [ "${#extra_links[@]}" -gt 0 ]; then
        managed_profile_extra_links_synced "$target_dir" "${extra_links[@]}" || return 0
    fi

    return 1
}

managed_profile_skills_synced() {
    local target_dir="$1"
    shift
    local skill
    for skill in "$@"; do
        local dest="$target_dir/$skill"
        local src="$REPO_DIR/skills/global/$skill"
        [ -d "$src" ] || return 1
        repo_path_installed_from "$src" "$dest" || return 1
    done
}

managed_profile_extra_links_synced() {
    local target_dir="$1"
    shift
    local link_spec
    for link_spec in "$@"; do
        local extra_src="${link_spec%%:*}"
        local extra_dest_name="${link_spec##*:}"
        local dest="$target_dir/$extra_dest_name"
        [ -e "$extra_src" ] || return 1
        repo_path_installed_from "$extra_src" "$dest" || return 1
    done
}

sync_existing_managed_skill_profile() {
    local tool="$1"
    local target_dir="$2"
    local profile_file="$3"
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

    local profile
    profile="$(resolve_existing_managed_profile "$tool" "$target_dir" "$profile_file")" || return 1

    if [ "${#extra_links[@]}" -gt 0 ]; then
        sync_managed_profile_if_needed \
            "$tool" "$target_dir" "$profile_file" "$profile" \
            "$label" "$missing_label" "$profile_writer" "${extra_links[@]}"
    else
        sync_managed_profile_if_needed \
            "$tool" "$target_dir" "$profile_file" "$profile" \
            "$label" "$missing_label" "$profile_writer"
    fi
}

sync_managed_profile_if_needed() {
    local tool="$1"
    local target_dir="$2"
    local profile_file="$3"
    local profile="$4"
    local label="$5"
    local missing_label="$6"
    local profile_writer="$7"
    shift 7
    local extra_links=("$@")
    local sync_args=("$tool" "$target_dir" "$profile_file" "$profile")
    if [ "${#extra_links[@]}" -gt 0 ]; then
        sync_args+=("${extra_links[@]}")
    fi
    managed_profile_needs_sync "${sync_args[@]}" || return 1

    local selected_skills=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && selected_skills+=("$skill")
    done < <(build_managed_skill_profile_list "$tool" "$profile")

    local install_args=("$target_dir" "$profile_file" "$profile" "$label" "$missing_label" "$profile_writer")
    if [ "${#extra_links[@]}" -gt 0 ]; then
        install_args+=("${extra_links[@]}")
    fi
    install_args+=("--")
    if [ "${#selected_skills[@]}" -gt 0 ]; then
        install_args+=("${selected_skills[@]}")
    fi
    install_managed_skill_profile "${install_args[@]}"
}

resolve_existing_managed_profile() {
    local tool="$1"
    local target_dir="$2"
    local profile_file="$3"
    local profile
    profile=$(read_profile_value "$profile_file" "profile" 2>/dev/null || true)
    case "$profile" in
        core|dev|full)
            printf '%s\n' "$profile"
            return 0
            ;;
    esac
    profile=$(infer_managed_skill_profile "$tool" "$target_dir" 2>/dev/null || true)
    case "$profile" in
        core|dev|full) printf '%s\n' "$profile" ;;
        *) return 1 ;;
    esac
}
