# This file must be sourced by bash, not executed directly.

resolve_workflow_repo_dir() {
    local candidates=()

    if [ -n "${WORKFLOW_REPO_DIR:-}" ]; then
        candidates+=("$WORKFLOW_REPO_DIR")
    fi

    candidates+=(
        "$REPO_DIR/vendor/workflow"
        "$HOME/.claude/skills/workflow"
        "$HOME/.codex/skills/workflow"
        "$HOME/workflow"
        "$REPO_DIR/../workflow"
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

find_workflow_config_bin() {
    local candidate
    for candidate in \
        "$HOME/.codex/skills/workflow/bin/workflow-config" \
        "$HOME/.claude/skills/workflow/bin/workflow-config" \
        "$REPO_DIR/vendor/workflow/bin/workflow-config"
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

write_goldband_wrapper_skill() {
    local source_skill="$1"
    local dest_dir="$2"
    local source_name="$3"
    local wrapper_name="$4"

    [ -f "$source_skill" ] || return 1

    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"

    awk \
        -v source_name="$source_name" \
        -v wrapper_name="$wrapper_name" \
        '
        BEGIN {
            name_done = 0
            trigger_done = 0
        }
        !name_done && $0 ~ /^name: / {
            print "name: " wrapper_name
            name_done = 1
            next
        }
        !trigger_done {
            old_trigger = "/" source_name "."
            new_trigger = "/" wrapper_name "."
            if (index($0, old_trigger)) {
                sub(old_trigger, new_trigger)
                trigger_done = 1
            }
        }
        { print }
        ' "$source_skill" \
        | sed 's|\${CLAUDE_SKILL_DIR}/\.\./|\${CLAUDE_SKILL_DIR}/../workflow/|g' \
        > "$dest_dir/SKILL.md"
}

rewrite_goldband_wrapper_runtime_paths() {
    local skill_file="$1"
    local tmp_file
    local legacy_runtime_name="g""stack"
    local legacy_claude_root="~/.claude/skills/$legacy_runtime_name"
    local legacy_claude_relative=".claude/skills/$legacy_runtime_name"
    # Keep $HOME escaped here because this function rewrites literal SKILL.md text,
    # not expanded filesystem paths.
    local legacy_codex_root_literal="\$HOME/.codex/skills/$legacy_runtime_name"
    local legacy_codex_home="~/.codex/skills/$legacy_runtime_name"
    local legacy_agents_root=".agents/skills/$legacy_runtime_name"

    [ -f "$skill_file" ] || return 0

    tmp_file="$(mktemp)"
    sed \
        -e "s|$legacy_claude_root|~/.claude/skills/workflow|g" \
        -e "s|$legacy_claude_relative|.claude/skills/workflow|g" \
        -e "s|$legacy_codex_root_literal|\\\$HOME/.codex/skills/workflow|g" \
        -e "s|$legacy_codex_home|~/.codex/skills/workflow|g" \
        -e "s|$legacy_agents_root|.agents/skills/workflow|g" \
        "$skill_file" > "$tmp_file"

    mv "$tmp_file" "$skill_file"
}

workflow_wrapper_manifest() {
    cat <<'EOF'
goldband-autoplan|autoplan|workflow-autoplan|自動跑完整計畫審查流程。|Automated end-to-end plan review workflow.
goldband-benchmark|benchmark|workflow-benchmark|效能基準與回歸檢查。|Performance baselines and regression checks.
goldband-browse|browse|workflow-browse|真實 Chromium 瀏覽器工具。|Real Chromium browser tooling.
goldband-canary|canary|workflow-canary|發版後觀察與快速驗證。|Post-release observation and rapid verification.
goldband-careful|careful|workflow-careful|高風險操作前提醒確認。|Prompt before high-risk operations.
goldband-codex|codex||用 Codex 做第二意見 review。|Use Codex for a second-opinion review.
goldband-cso|cso|workflow-cso|深度安全審查。|Deep security review.
goldband-design-consultation|design-consultation|workflow-design-consultation|設計方向與系統規劃。|Design direction and system planning.
goldband-design-review|design-review|workflow-design-review|設計審查與修正。|Design review and correction.
goldband-document-release|document-release|workflow-document-release|同步更新 README 與發版文件。|Sync README and release docs.
goldband-freeze|freeze|workflow-freeze|限制編輯範圍，避免改太多。|Limit edit scope to avoid changing too much.
goldband-guard|guard|workflow-guard|careful + freeze 的任務保護。|Combined careful and freeze task guardrails.
goldband-investigate|investigate|workflow-investigate|系統化除錯與根因調查。|Systematic debugging and root-cause investigation.
goldband-land-and-deploy|land-and-deploy|workflow-land-and-deploy|merge、deploy、上線後驗證。|Merge, deploy, and post-launch verification.
goldband-office-hours|office-hours|workflow-office-hours|從產品角度重想問題與方向。|Reframe the problem from a product perspective.
goldband-plan-ceo-review|plan-ceo-review|workflow-plan-ceo-review|用 CEO 視角重審計畫。|Review the plan from a CEO perspective.
goldband-plan-design-review|plan-design-review|workflow-plan-design-review|實作前先做設計審查。|Design review before implementation.
goldband-plan-eng-review|plan-eng-review|workflow-plan-eng-review|實作前先做工程規劃審查。|Engineering review before implementation.
goldband-qa|qa|workflow-qa|用真實瀏覽器做 QA 與驗證。|Browser-based QA and verification.
goldband-qa-only|qa-only|workflow-qa-only|只測不修，輸出 bug report。|Test only, no fixes; output a bug report.
goldband-review|review|workflow-review|針對目前 diff 做上線前審查。|Pre-landing review for the current diff.
goldband-retro|retro|workflow-retro|回顧近期輸出與改善方向。|Review recent output and improvement directions.
goldband-setup-browser-cookies|setup-browser-cookies|workflow-setup-browser-cookies|匯入瀏覽器 cookies 供 QA 使用。|Import browser cookies for QA.
goldband-setup-deploy|setup-deploy|workflow-setup-deploy|設定 deploy 與 production 驗證資訊。|Configure deploy and production verification info.
goldband-ship|ship|workflow-ship|發版與提 PR 流程。|Release and open a PR.
goldband-unfreeze|unfreeze|workflow-unfreeze|解除 freeze 限制。|Remove freeze restrictions.
EOF
}

goldband_wrapper_description() {
    local wrapper_name="$1"
    local language="${2:-zh-TW}"
    workflow_wrapper_manifest \
        | awk -F'|' -v name="$wrapper_name" -v lang="$language" '
            $1 == name {
                if (lang == "en") {
                    print "  " $5
                } else {
                    print "  " $4
                }
                found = 1
            }
            END { exit(found ? 0 : 1) }
        '
}

localize_goldband_wrapper_description() {
    local skill_file="$1"
    local wrapper_name="$2"
    local language="${3:-zh-TW}"
    local temp_file
    temp_file="$(mktemp)"

    goldband_wrapper_description "$wrapper_name" "$language" > "$temp_file"
    awk -v desc_file="$temp_file" '
        BEGIN {
            in_description = 0
            replaced = 0
        }
        replaced == 0 && $0 ~ /^description: [^|].*$/ {
            print "description: |"
            while ((getline line < desc_file) > 0) {
                print line
            }
            close(desc_file)
            replaced = 1
            next
        }
        replaced == 0 && $0 ~ /^description: \|$/ {
            print $0
            in_description = 1
            next
        }
        in_description == 1 {
            if ($0 ~ /^allowed-tools:/ || $0 ~ /^hooks:/ || $0 == "---") {
                while ((getline line < desc_file) > 0) {
                    print line
                }
                close(desc_file)
                print $0
                in_description = 0
                replaced = 1
                next
            }
            next
        }
        { print }
        END {
            if (in_description == 1 && replaced == 0) {
                while ((getline line < desc_file) > 0) {
                    print line
                }
                close(desc_file)
            }
        }
        ' "$skill_file" > "${skill_file}.tmp"

    mv "${skill_file}.tmp" "$skill_file"
    rm -f "$temp_file"
}

localize_goldband_wrapper_language_policy() {
    local skill_file="$1"

    [ -f "$skill_file" ] || return 0
    if grep -q '^## Goldband Wrapper Language Policy$' "$skill_file"; then
        return 0
    fi

    awk '
        BEGIN {
            frontmatter_markers = 0
            inserted = 0
        }
        {
            print
            if (!inserted && $0 == "---") {
                frontmatter_markers++
                if (frontmatter_markers == 2) {
                    print ""
                    print "## Goldband Wrapper Language Policy"
                    print ""
                    print "- 先讀取 `workflow-config get goldband_language`。支援 `zh-TW` 與 `en`，預設 `zh-TW`。"
                    print "- 若 `GOLDBAND_LANGUAGE` 是 `en`，所有直接顯示給使用者的提問、建議、選項、摘要，一律使用英文。"
                    print "- 否則所有直接顯示給使用者的提問、建議、選項、摘要，一律使用繁體中文。"
                    print "- 保留英文只用於 code、identifiers、commands、paths、env vars、filenames、以及精確 error strings。"
                    print "- 若繼承的 workflow 指令範本、AskUserQuestion 結構或內文示例和目前選擇語言不同，實際輸出前先翻成目前選擇的語言，不要直接把另一種語言的模板顯示給使用者。"
                    inserted = 1
                }
            }
        }
        END {
            if (!inserted) {
                print ""
                print "## Goldband Wrapper Language Policy"
                print ""
                print "- 先讀取 `workflow-config get goldband_language`。支援 `zh-TW` 與 `en`，預設 `zh-TW`。"
                print "- 若 `GOLDBAND_LANGUAGE` 是 `en`，所有直接顯示給使用者的提問、建議、選項、摘要，一律使用英文。"
                print "- 否則所有直接顯示給使用者的提問、建議、選項、摘要，一律使用繁體中文。"
                print "- 保留英文只用於 code、identifiers、commands、paths、env vars、filenames、以及精確 error strings。"
                print "- 若繼承的 workflow 指令範本、AskUserQuestion 結構或內文示例和目前選擇語言不同，實際輸出前先翻成目前選擇的語言，不要直接把另一種語言的模板顯示給使用者。"
            }
        }
    ' "$skill_file" > "${skill_file}.tmp"

    mv "${skill_file}.tmp" "$skill_file"
}

inject_goldband_wrapper_language_runtime() {
    local skill_file="$1"

    [ -f "$skill_file" ] || return 0
    if grep -q '^_GOLDBAND_LANGUAGE=' "$skill_file"; then
        return 0
    fi

    awk '
        BEGIN { inserted = 0 }
        {
            print
            if (!inserted && $0 ~ /^_PROACTIVE=.*workflow-config get proactive/) {
                print "_GOLDBAND_LANGUAGE=$($WORKFLOW_BIN/workflow-config get goldband_language 2>/dev/null || echo \"zh-TW\")"
                print "[ -n \"$_GOLDBAND_LANGUAGE\" ] || _GOLDBAND_LANGUAGE=\"zh-TW\""
                print "echo \"GOLDBAND_LANGUAGE: $_GOLDBAND_LANGUAGE\""
                inserted = 1
            }
        }
    ' "$skill_file" > "${skill_file}.tmp"

    mv "${skill_file}.tmp" "$skill_file"
}

hide_workflow_root_skill() {
    local runtime_root="$1"
    local source_root
    local entry
    local base

    [ -e "$runtime_root" ] || return 0

    if [ -L "$runtime_root" ]; then
        source_root="$(readlink "$runtime_root")"
        [ -n "$source_root" ] || return 1

        rm -rf "$runtime_root"
        mkdir -p "$runtime_root"

        for entry in "$source_root"/.* "$source_root"/*; do
            [ -e "$entry" ] || continue
            base="${entry##*/}"
            [ "$base" = "." ] || [ "$base" = ".." ] && continue
            [ "$base" = "SKILL.md" ] && continue
            ln -snf "$entry" "$runtime_root/$base"
        done
        return 0
    fi

    rm -f "$runtime_root/SKILL.md"
}

hide_workflow_root_skills() {
    local host="$1"

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        hide_workflow_root_skill "$HOME/.claude/skills/workflow"
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        hide_workflow_root_skill "$HOME/.codex/skills/workflow"
    fi
}

create_goldband_workflow_aliases() {
    local claude_runtime_root="$HOME/.claude/skills/workflow"
    local codex_skills_root="$HOME/.codex/skills"
    local goldband_language="zh-TW"
    local workflow_config_bin
    local alias_name
    local claude_target
    local codex_target
    local _description
    local _description_en

    if workflow_config_bin="$(find_workflow_config_bin 2>/dev/null)"; then
        goldband_language="$(read_goldband_wrapper_language "$workflow_config_bin")"
    fi

    while IFS='|' read -r alias_name claude_target codex_target _description _description_en; do
        if [ -d "$claude_runtime_root" ] && [ -n "$claude_target" ]; then
            local alias_path="$HOME/.claude/skills/$alias_name"
            local source_skill="$claude_runtime_root/$claude_target/SKILL.md"
            if [ -f "$source_skill" ]; then
                write_goldband_wrapper_skill "$source_skill" "$alias_path" "$claude_target" "$alias_name"
                localize_goldband_wrapper_description "$alias_path/SKILL.md" "$alias_name" "$goldband_language"
                inject_goldband_wrapper_language_runtime "$alias_path/SKILL.md"
                localize_goldband_wrapper_language_policy "$alias_path/SKILL.md"
                rewrite_goldband_wrapper_runtime_paths "$alias_path/SKILL.md"
            fi
        fi

        if [ -d "$codex_skills_root" ] && [ -n "$codex_target" ]; then
            local alias_path="$codex_skills_root/$alias_name"
            local source_skill="$codex_skills_root/$codex_target/SKILL.md"
            local source_name="${codex_target#workflow-}"
            if [ -f "$source_skill" ]; then
                write_goldband_wrapper_skill "$source_skill" "$alias_path" "$source_name" "$alias_name"
                localize_goldband_wrapper_description "$alias_path/SKILL.md" "$alias_name" "$goldband_language"
                inject_goldband_wrapper_language_runtime "$alias_path/SKILL.md"
                localize_goldband_wrapper_language_policy "$alias_path/SKILL.md"
                rewrite_goldband_wrapper_runtime_paths "$alias_path/SKILL.md"
            fi
        fi
    done < <(workflow_wrapper_manifest)
}

cleanup_workflow_user_entries() {
    local claude_skills_dir="$HOME/.claude/skills"
    local codex_skills_dir="$HOME/.codex/skills"
    local legacy_runtime_name="g""stack"
    local legacy_upgrade_name="${legacy_runtime_name}-upgrade"
    local legacy_goldband_upgrade_name="goldband-${legacy_runtime_name}-upgrade"
    local alias_name
    local claude_target
    local codex_target
    local _description
    local claude_cleanup=()
    local codex_cleanup=()

    while IFS='|' read -r alias_name claude_target codex_target _description; do
        [ -n "$claude_target" ] && claude_cleanup+=("$claude_target")
        [ -n "$codex_target" ] && codex_cleanup+=("$codex_target")
    done < <(workflow_wrapper_manifest)

    claude_cleanup+=("goldband-upgrade" "$legacy_upgrade_name" "$legacy_goldband_upgrade_name" "$legacy_runtime_name" "${legacy_runtime_name}.bak")
    codex_cleanup+=("goldband-upgrade" "$legacy_goldband_upgrade_name" "$legacy_runtime_name")

    local entry
    for entry in "${claude_cleanup[@]}"; do
        [ -n "$entry" ] || continue
        rm -rf "$claude_skills_dir/$entry"
    done
    for entry in "${codex_cleanup[@]}"; do
        [ -n "$entry" ] || continue
        rm -rf "$codex_skills_dir/$entry"
    done

    for entry in "$claude_skills_dir"/workflow.bak* "$codex_skills_dir"/workflow.bak*; do
        [ -e "$entry" ] || continue
        rm -rf "$entry"
    done
}

normalize_workflow_runtime_install() {
    local host="$1"
    local legacy_runtime_name="g""stack"

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        local legacy_claude_root="$HOME/.claude/skills/$legacy_runtime_name"
        local workflow_claude_root="$HOME/.claude/skills/workflow"

        if [ -e "$legacy_claude_root" ]; then
            rm -rf "$workflow_claude_root"
            mv "$legacy_claude_root" "$workflow_claude_root"
        fi
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        local legacy_codex_root="$HOME/.codex/skills/$legacy_runtime_name"
        local workflow_codex_root="$HOME/.codex/skills/workflow"
        local legacy_skill
        local workflow_skill
        local legacy_prefix="${legacy_runtime_name}-"

        if [ -e "$legacy_codex_root" ]; then
            rm -rf "$workflow_codex_root"
            mv "$legacy_codex_root" "$workflow_codex_root"
        fi

        for legacy_skill in "$HOME/.codex/skills"/"$legacy_prefix"*; do
            [ -e "$legacy_skill" ] || continue
            workflow_skill="$HOME/.codex/skills/workflow-${legacy_skill##*/$legacy_prefix}"
            rm -rf "$workflow_skill"
            mv "$legacy_skill" "$workflow_skill"
        done
    fi
}

install_workflow_host() {
    local host="$1"
    local repo_dir
    local setup_output
    local legacy_runtime_name="g""stack"

    if ! repo_dir="$(resolve_workflow_repo_dir)"; then
        echo -e "${RED}找不到 workflow runtime。${NC}"
        echo -e "  可設定 ${CYAN}WORKFLOW_REPO_DIR=/path/to/runtime${NC} 後重試"
        echo -e "  預設會先找 repo 內建的 ${CYAN}$REPO_DIR/vendor/workflow${NC}"
        exit 1
    fi

    local version="unknown"
    version="$(read_workflow_version "$repo_dir" 2>/dev/null || echo "unknown")"
    echo -e "${GREEN}安裝 workflow runtime (${host})...${NC}"
    echo -e "  repo: ${CYAN}$repo_dir${NC}"
    echo -e "  version: ${CYAN}$version${NC}"
    echo ""
    if ! setup_output="$(
        cd "$repo_dir" || {
            echo "  [錯誤] 無法進入 workflow runtime: $repo_dir"
            exit 1
        }
        ./setup --host "$host" 2>&1
    )"; then
        printf '%s\n' "$setup_output" | sed "s/$legacy_runtime_name/workflow/g"
        exit 1
    fi
    if [ -n "$setup_output" ]; then
        printf '%s\n' "$setup_output" | sed "s/$legacy_runtime_name/workflow/g"
    fi
    normalize_workflow_runtime_install "$host"
    create_goldband_workflow_aliases
    cleanup_workflow_user_entries
    hide_workflow_root_skills "$host"
}
