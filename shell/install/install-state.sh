# This file must be sourced by bash, not executed directly.

install_state_file() {
    local state_root="${GOLDBAND_HOME:-$HOME/.goldband}"
    printf '%s\n' "$state_root/install-state.json"
}

install_state_dir() {
    dirname "$(install_state_file)"
}

install_state_python_available() {
    command -v python3 >/dev/null 2>&1 || return 1
    python3 -c 'import json' >/dev/null 2>&1
}

install_state_node_available() {
    command -v node >/dev/null 2>&1 || return 1
    node -e 'JSON.parse("{}")' >/dev/null 2>&1
}

normalize_install_target() {
    case "$1" in
        help|-h|--help|status|auto-refresh)
            return 1
            ;;
        pack-core)
            printf '%s\n' skills-core claude-guidance rules hooks launchers
            ;;
        all|pack-quality)
            printf '%s\n' skills-dev claude-guidance commands rules hooks launchers
            ;;
        all-full)
            printf '%s\n' skills-full claude-guidance commands rules hooks launchers
            ;;
        all-tools)
            printf '%s\n' skills-full claude-guidance commands rules hooks launchers codex-full
            ;;
        all-with-workflow)
            printf '%s\n' skills-full claude-guidance commands rules hooks launchers codex-full workflow-auto
            ;;
        skills)
            printf 'skills-full\n'
            ;;
        codex)
            printf 'codex-full\n'
            ;;
        repair-codex-rules|codex-repair)
            printf 'codex-rules\n'
            ;;
        workflow-slim|workflow-full)
            printf 'workflow\n'
            ;;
        workflow-codex-slim|workflow-codex-full)
            printf 'workflow-codex\n'
            ;;
        workflow-auto-slim|workflow-auto-full)
            printf 'workflow-auto\n'
            ;;
        *)
            printf '%s\n' "$1"
            ;;
    esac
}

dedupe_lines() {
    awk 'NF && !seen[$0]++'
}

install_state_targets() {
    local state_file
    state_file="$(install_state_file)"
    [ -f "$state_file" ] || return 0

    if install_state_python_available; then
        python3 - "$state_file" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    data = {}

for target in data.get("targets", []):
    if isinstance(target, str) and target:
        print(target)
PY
        return 0
    fi

    if install_state_node_available; then
        node -e '
const fs = require("fs");
let data = {};
try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
for (const target of data.targets || []) {
  if (typeof target === "string" && target) console.log(target);
}
' "$state_file"
        return 0
    fi

    sed -n 's/.*"targets"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p' "$state_file" \
        | tr ',' '\n' \
        | sed 's/["[:space:]]//g' \
        | sed '/^$/d'
}

install_state_write() {
    local refresh_status="${1:-}"
    local refresh_old="${2:-}"
    local refresh_new="${3:-}"
    local refresh_message="${4:-}"
    shift 4 || true
    local targets=("$@")
    local state_file state_dir
    state_file="$(install_state_file)"
    state_dir="$(dirname "$state_file")"
    mkdir -p "$state_dir"

    if install_state_python_available; then
        install_state_write_python "$state_file" "$refresh_status" "$refresh_old" "$refresh_new" "$refresh_message" "${targets[@]}"
        return 0
    fi

    install_state_write_fallback "$state_file" "$refresh_status" "$refresh_old" "$refresh_new" "$refresh_message" "${targets[@]}"
}

install_state_write_python() {
    local state_file="$1"
    local refresh_status="$2"
    local refresh_old="$3"
    local refresh_new="$4"
    local refresh_message="$5"
    shift 5
    INSTALL_STATE_TARGETS="$(printf '%s\n' "$@" | dedupe_lines)" \
    python3 - "$state_file" "$REPO_DIR" "$refresh_status" "$refresh_old" "$refresh_new" "$refresh_message" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

state_file, repo, status, old, new, message = sys.argv[1:7]
targets = [line for line in os.environ.get("INSTALL_STATE_TARGETS", "").splitlines() if line]

try:
    with open(state_file, encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    data = {}

now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
data["version"] = 1
data["updatedAt"] = now
data["repo"] = repo
data["targets"] = targets

if status:
    data["lastAutoRefresh"] = {
        "status": status,
        "updatedAt": now,
        "oldHead": old or None,
        "newHead": new or None,
        "message": message or None,
        "targets": targets,
    }

tmp = f"{state_file}.tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(tmp, state_file)
PY
}

install_state_write_fallback() {
    local state_file="$1"
    local refresh_status="$2"
    local refresh_old="$3"
    local refresh_new="$4"
    local refresh_message="$5"
    local tmp_file="${state_file}.tmp.$$"
    shift 5
    local updated_at
    updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    {
        printf '{\n'
        printf '  "version": 1,\n'
        printf '  "updatedAt": "%s",\n' "$updated_at"
        printf '  "repo": "%s",\n' "$(printf '%s' "$REPO_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')"
        printf '  "targets": ['
        local first=true target
        for target in "$@"; do
            [ -n "$target" ] || continue
            if $first; then
                first=false
            else
                printf ', '
            fi
            printf '"%s"' "$target"
        done
        printf ']'
        if [ -n "$refresh_status" ]; then
            printf ',\n'
            printf '  "lastAutoRefresh": {\n'
            printf '    "status": "%s",\n' "$(json_escape_string "$refresh_status")"
            printf '    "updatedAt": "%s",\n' "$updated_at"
            printf '    "oldHead": %s,\n' "$(json_nullable_string "$refresh_old")"
            printf '    "newHead": %s,\n' "$(json_nullable_string "$refresh_new")"
            printf '    "message": %s,\n' "$(json_nullable_string "$refresh_message")"
            printf '    "targets": ['
            first=true
            for target in "$@"; do
                [ -n "$target" ] || continue
                if $first; then
                    first=false
                else
                    printf ', '
                fi
                printf '"%s"' "$(json_escape_string "$target")"
            done
            printf ']\n'
            printf '  }\n'
        else
            printf '\n'
        fi
        printf '}\n'
    } > "$tmp_file"
    mv "$tmp_file" "$state_file"
}

json_escape_string() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

json_nullable_string() {
    if [ -z "$1" ]; then
        printf 'null'
    else
        printf '"%s"' "$(json_escape_string "$1")"
    fi
}

record_installed_target() {
    local targets=()
    local existing normalized
    while IFS= read -r existing; do
        [ -n "$existing" ] && targets+=("$existing")
    done < <(install_state_targets)
    while IFS= read -r normalized; do
        [ -n "$normalized" ] && targets+=("$normalized")
    done < <(normalize_install_target "$1" 2>/dev/null || true)
    install_state_write "" "" "" "" "${targets[@]}"
}

auto_refresh_target() {
    local target="$1"
    local normalized
    while IFS= read -r normalized; do
        [ -n "$normalized" ] || continue
        if ! auto_refresh_safe_target "$normalized"; then
            skipped+=("$normalized")
            continue
        fi
        if auto_refresh_install_target "$normalized"; then
            refreshed+=("$normalized")
        else
            failed+=("$normalized")
        fi
    done < <(normalize_install_target "$target" 2>/dev/null || true)
}

clear_install_state() {
    rm -f "$(install_state_file)" 2>/dev/null || true
}

detect_installed_refresh_targets() {
    local targets=()
    local profile_line profile

    if [ -f "$SKILL_PROFILE_FILE" ]; then
        profile_line=$(grep '^profile=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
        profile="${profile_line#profile=}"
        case "$profile" in
            core) targets+=("skills-core") ;;
            dev) targets+=("skills-dev") ;;
            full) targets+=("skills-full") ;;
        esac
    fi

    repo_path_installed_from "$REPO_DIR/claude/CLAUDE.md" "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE" && targets+=("claude-guidance")
    repo_path_installed_from "$REPO_DIR/commands" "$CLAUDE_DIR/commands" && targets+=("commands")
    repo_path_installed_from "$REPO_DIR/rules" "$CLAUDE_DIR/rules" && targets+=("rules")
    repo_path_installed_from "$REPO_DIR/rules" "$CLAUDE_DIR/goldband-rules" && targets+=("rules")
    repo_path_installed_from "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts" && targets+=("hooks")
    shell_launchers_installed && targets+=("launchers")

    is_generated_codex_config "$CODEX_CONFIG_FILE" && targets+=("codex-config")
    repo_path_installed_from "$REPO_DIR/codex/AGENTS.md" "$CODEX_AGENTS_FILE" && targets+=("codex-agents")
    repo_path_installed_from "$REPO_DIR/codex/agents" "$CODEX_CUSTOM_AGENTS_DIR" && targets+=("codex-agents")
    repo_path_installed_from "$REPO_DIR/codex/prompts/goldband.md" "$CODEX_GOLDBAND_PROMPT_FILE" && targets+=("codex-prompts")
    repo_path_installed_from "$REPO_DIR/codex/hooks.json" "$CODEX_HOOKS_FILE" && targets+=("codex-hooks")
    repo_path_installed_from "$REPO_DIR/codex/hooks" "$CODEX_HOOKS_DIR" && targets+=("codex-hooks")
    repo_path_installed_from "$REPO_DIR/hooks/scripts/lib/rules-resolver.js" "$CODEX_REVIEW_RUNTIME_FILE" && targets+=("codex-hooks")
    [ -f "$CODEX_RULES_DIR/goldband.rules" ] && targets+=("codex-rules")
    [ -f "$CODEX_SKILL_PROFILE_FILE" ] && targets+=("codex-skills")

    [ -d "$HOME/.claude/skills/goldband" ] && targets+=("workflow")
    [ -d "$HOME/.codex/skills/goldband" ] && targets+=("workflow-codex")

    printf '%s\n' "${targets[@]}" | dedupe_lines
}

auto_refresh_security_target_allowed() {
    [ "${GOLDBAND_AUTO_REFRESH_SECURITY_TARGETS:-}" = "1" ]
}

auto_refresh_safe_target() {
    case "$1" in
        hooks|rules|codex-hooks|codex-rules)
            auto_refresh_security_target_allowed
            ;;
        skills-core|skills-dev|skills-full|claude-guidance|commands|launchers|\
        codex-core|codex-full|codex-config|codex-agents|codex-prompts|codex-skills|\
        workflow|workflow-codex|workflow-auto)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

auto_refresh_install_target() {
    case "$1" in
        skills-core) install_skills_core ;;
        skills-dev) install_skills_dev ;;
        skills-full) install_skills ;;
        claude-guidance) install_claude_guidance ;;
        commands) install_commands ;;
        rules) install_rules ;;
        hooks) install_hooks ;;
        launchers) install_launchers ;;
        codex-core) install_codex_core ;;
        codex-full) install_codex_full ;;
        codex-config) install_codex_config ;;
        codex-agents) install_codex_agents ;;
        codex-prompts) install_codex_prompts ;;
        codex-hooks) install_codex_hooks ;;
        codex-rules) install_codex_rules ;;
        codex-skills) install_codex_skills ;;
        workflow) install_workflow_host "claude" "standard" ;;
        workflow-codex) install_workflow_host "codex" "standard" ;;
        workflow-auto) install_workflow_host "auto" "standard" ;;
        *) return 1 ;;
    esac
}

run_auto_refresh() {
    local old_head="${1:-}"
    local new_head="${2:-}"
    local targets=()
    local target

    while IFS= read -r target; do
        [ -n "$target" ] && targets+=("$target")
    done < <(install_state_targets)

    if [ "${#targets[@]}" -eq 0 ]; then
        while IFS= read -r target; do
            [ -n "$target" ] && targets+=("$target")
        done < <(detect_installed_refresh_targets)
    fi

    if [ "${#targets[@]}" -eq 0 ]; then
        install_state_write "skipped" "$old_head" "$new_head" "no installed goldband-managed targets detected"
        return 0
    fi

    local refreshed=()
    local skipped=()
    local failed=()
    for target in "${targets[@]}"; do
        auto_refresh_target "$target"
    done

    local message="refreshed: $(join_by_comma "${refreshed[@]}")"
    if [ "${#skipped[@]}" -gt 0 ]; then
        message="$message; skipped unsafe: $(join_by_comma "${skipped[@]}")"
    fi
    if [ "${#failed[@]}" -gt 0 ]; then
        message="$message; failed: $(join_by_comma "${failed[@]}")"
        install_state_write "partial" "$old_head" "$new_head" "$message" "${targets[@]}"
        return 1
    fi

    install_state_write "success" "$old_head" "$new_head" "$message" "${targets[@]}"
}

show_auto_update_status() {
    local state_file
    state_file="$(install_state_file)"
    if [ ! -f "$state_file" ]; then
        echo -e "  ${YELLOW}[未建立]${NC} auto-update install-state — 下次自動更新會偵測 goldband-managed surfaces"
        return 0
    fi

    if install_state_python_available; then
        python3 - "$state_file" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
except Exception as exc:
    print(f"  [警告] auto-update install-state 無法讀取: {exc}")
    sys.exit(0)

targets = ", ".join(data.get("targets") or []) or "none"
print(f"  [OK] auto-update tracked targets: {targets}")
last = data.get("lastAutoRefresh")
if isinstance(last, dict):
    status = last.get("status") or "unknown"
    updated = last.get("updatedAt") or "unknown time"
    message = last.get("message") or ""
    print(f"  [OK] last auto-refresh: {status} at {updated}")
    if message:
        print(f"    {message}")
PY
        return 0
    fi

    if install_state_node_available; then
        node -e '
const fs = require("fs");
let data = {};
try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (error) {
  console.log(`  [警告] auto-update install-state 無法讀取: ${error.message}`);
  process.exit(0);
}
const targets = (data.targets || []).join(", ") || "none";
console.log(`  [OK] auto-update tracked targets: ${targets}`);
const last = data.lastAutoRefresh;
if (last && typeof last === "object") {
  console.log(`  [OK] last auto-refresh: ${last.status || "unknown"} at ${last.updatedAt || "unknown time"}`);
  if (last.message) console.log(`    ${last.message}`);
}
' "$state_file"
        return 0
    fi

    echo -e "  ${GREEN}[OK]${NC} auto-update install-state -> $state_file"
}
