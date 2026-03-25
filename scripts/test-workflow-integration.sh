#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d /tmp/goldband-workflow-home.XXXXXX)"
TMP_WORKFLOW="$(mktemp -d /tmp/goldband-workflow-repo.XXXXXX)"
TMP_ROOT="$(mktemp -d /tmp/goldband-workflow-root.XXXXXX)"
TMP_UPDATE_ORIGIN="$(mktemp -d /tmp/goldband-update-origin.XXXXXX)"
TMP_UPDATE_SEED="$(mktemp -d /tmp/goldband-update-seed.XXXXXX)"
TMP_UPDATE_WORK="$(mktemp -d /tmp/goldband-update-work.XXXXXX)"
LEGACY_RUNTIME_NAME="g""stack"
LEGACY_GOLDBAND_UPGRADE="goldband-${LEGACY_RUNTIME_NAME}-upgrade"
trap 'rm -rf "$TMP_HOME" "$TMP_WORKFLOW" "$TMP_ROOT" "$TMP_UPDATE_ORIGIN" "$TMP_UPDATE_SEED" "$TMP_UPDATE_WORK"' EXIT

mkdir -p \
  "$TMP_WORKFLOW/bin" \
  "$TMP_WORKFLOW/careful" \
  "$TMP_WORKFLOW/freeze" \
  "$TMP_WORKFLOW/investigate" \
  "$TMP_WORKFLOW/review" \
  "$TMP_WORKFLOW/qa" \
  "$TMP_WORKFLOW/ship" \
  "$TMP_WORKFLOW/browse"

cat > "$TMP_WORKFLOW/VERSION" <<'EOF'
0.0.0-test
EOF

cat > "$TMP_WORKFLOW/SKILL.md" <<'EOF'
---
name: workflow
description: test fixture
---
EOF

for skill in careful freeze investigate review qa ship browse; do
  cat > "$TMP_WORKFLOW/$skill/SKILL.md" <<EOF
---
name: $skill
description: test fixture
---
$(if [ "$skill" = "investigate" ]; then cat <<'SKILL_BODY'
```bash
WORKFLOW_BIN="$HOME/.codex/skills/workflow/bin"
_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")
source <(~/.claude/skills/workflow/bin/workflow-repo-mode 2>/dev/null) || true
```
SKILL_BODY
fi)
EOF
done

cat > "$TMP_WORKFLOW/review/checklist.md" <<'EOF'
# test checklist
EOF

cat > "$TMP_WORKFLOW/bin/workflow-repo-mode" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TMP_WORKFLOW/bin/workflow-repo-mode"

cat > "$TMP_WORKFLOW/bin/workflow-config" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${WORKFLOW_STATE_DIR:-$HOME/.workflow}"
CONFIG_FILE="$STATE_DIR/config.yaml"
case "${1:-}" in
  get)
    KEY="${2:?missing key}"
    grep -E "^${KEY}:" "$CONFIG_FILE" 2>/dev/null | tail -1 | awk '{print $2}' | tr -d '[:space:]' || true
    ;;
  set)
    KEY="${2:?missing key}"
    VALUE="${3:?missing value}"
    mkdir -p "$STATE_DIR"
    if grep -qE "^${KEY}:" "$CONFIG_FILE" 2>/dev/null; then
      sed -i '' "s/^${KEY}:.*/${KEY}: ${VALUE}/" "$CONFIG_FILE"
    else
      echo "${KEY}: ${VALUE}" >> "$CONFIG_FILE"
    fi
    ;;
  list)
    cat "$CONFIG_FILE" 2>/dev/null || true
    ;;
  *)
    echo "Usage: workflow-config {get|set|list} [key] [value]" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$TMP_WORKFLOW/bin/workflow-config"

cat > "$TMP_WORKFLOW/setup" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HOST="claude"
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --host=*) HOST="${1#--host=}"; shift ;;
    *) shift ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$ROOT/VERSION")"
mkdir -p "$HOME/.workflow/projects"

install_claude() {
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$HOME/.claude/skills/workflow"
  ln -s "$ROOT" "$HOME/.claude/skills/workflow"
}

install_codex() {
  mkdir -p "$HOME/.codex/skills"
  rm -rf "$HOME/.codex/skills/workflow"
  ln -s "$ROOT" "$HOME/.codex/skills/workflow"
  for skill in investigate review qa ship careful freeze; do
    target="$HOME/.codex/skills/workflow-$skill"
    rm -rf "$target"
    mkdir -p "$target"
    cat > "$target/SKILL.md" <<SKILL
---
name: workflow-$skill
description: generated test fixture
---
$(if [ "$skill" = "investigate" ]; then cat <<'SKILL_BODY'
```bash
WORKFLOW_ROOT="$HOME/.codex/skills/workflow"
[ -n "$_ROOT" ] && [ -d "$_ROOT/.agents/skills/workflow" ] && WORKFLOW_ROOT="$_ROOT/.agents/skills/workflow"
WORKFLOW_BIN="$WORKFLOW_ROOT/bin"
_PROACTIVE=$($WORKFLOW_BIN/workflow-config get proactive 2>/dev/null || echo "true")
```
SKILL_BODY
fi)
SKILL
  done
  printf '%s\n' "$VERSION" > "$HOME/.codex/skills/workflow/.installed-version"
}

case "$HOST" in
  claude)
    install_claude
    ;;
  codex)
    install_codex
    ;;
  auto)
    install_claude
    install_codex
    ;;
  *)
    echo "unsupported host: $HOST" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$TMP_WORKFLOW/setup"

mkdir -p "$TMP_ROOT/vendor"
cp "$ROOT_DIR/install.sh" "$TMP_ROOT/install.sh"
cp "$ROOT_DIR/AGENTS.md" "$TMP_ROOT/AGENTS.md"
cp -R "$ROOT_DIR/skills" "$TMP_ROOT/skills"
cp -R "$ROOT_DIR/hooks" "$TMP_ROOT/hooks"
cp -R "$ROOT_DIR/commands" "$TMP_ROOT/commands"
cp -R "$ROOT_DIR/contexts" "$TMP_ROOT/contexts"
cp -R "$ROOT_DIR/rules" "$TMP_ROOT/rules"
cp -R "$ROOT_DIR/codex" "$TMP_ROOT/codex"
cp -R "$ROOT_DIR/.claude-plugin" "$TMP_ROOT/.claude-plugin"
cp -R "$ROOT_DIR/shell" "$TMP_ROOT/shell"
cp -R "$TMP_WORKFLOW" "$TMP_ROOT/vendor/workflow"
chmod +x "$TMP_ROOT/install.sh"

echo "[1/5] skill checks"
"$ROOT_DIR/scripts/check-skills.sh"

echo "[2/5] installer smoke"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow >/tmp/goldband-workflow-install.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-codex >/tmp/goldband-workflow-codex.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" all-with-workflow >/tmp/goldband-all-with-workflow.log

echo "[3/6] verify symlinks"
test -d "$TMP_HOME/.claude/skills/workflow"
test -d "$TMP_HOME/.codex/skills/workflow"
test -d "$TMP_HOME/.workflow/projects"
test -f "$TMP_HOME/.codex/skills/workflow/VERSION"
test -L "$TMP_HOME/.claude/commands"
test -L "$TMP_HOME/.claude/contexts"
test -L "$TMP_HOME/.claude/rules"
test -L "$TMP_HOME/.claude/hooks/scripts"
test -L "$TMP_HOME/.claude/statusline-command.sh"
test -L "$TMP_HOME/.codex/config.toml"
test -L "$TMP_HOME/.codex/AGENTS.md"
test -L "$TMP_HOME/.codex/rules"
test -L "$TMP_HOME/.claude/bin/goldband-self-update"
test -L "$TMP_HOME/.claude/shell/goldband-launchers.sh"
test ! -e "$TMP_HOME/.claude/skills/workflow/SKILL.md"
test ! -e "$TMP_HOME/.codex/skills/workflow/SKILL.md"
test -e "$TMP_HOME/.claude/skills/workflow/freeze"
test -e "$TMP_HOME/.claude/skills/workflow/bin/workflow-repo-mode"
test -e "$TMP_HOME/.codex/skills/workflow/review"
test -e "$TMP_HOME/.codex/skills/workflow/bin/workflow-config"
test -f "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"
test -f "$TMP_HOME/.claude/commands/goldband-language.md"
test -f "$TMP_HOME/.claude/commands/scripts/set-goldband-language.sh"
grep -q '^# >>> goldband shell launchers >>>$' "$TMP_HOME/.zshrc"
grep -q 'source "\$HOME/.claude/shell/goldband-launchers.sh"' "$TMP_HOME/.zshrc"
test ! -e "$TMP_HOME/.claude/skills/review"
test ! -e "$TMP_HOME/.claude/skills/goldband-upgrade"
test ! -e "$TMP_HOME/.codex/skills/workflow-review"
test ! -e "$TMP_HOME/.codex/skills/goldband-upgrade"
test ! -e "$TMP_HOME/.codex/skills/$LEGACY_RUNTIME_NAME"
test ! -e "$TMP_HOME/.codex/skills/$LEGACY_GOLDBAND_UPGRADE"
test "$(readlink "$TMP_HOME/.claude/commands")" = "$TMP_ROOT/commands"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
grep -q '^name: goldband-qa$' "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
grep -q '^name: goldband-ship$' "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
grep -q '^name: goldband-browse$' "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
grep -q '^name: goldband-qa$' "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
grep -q '^name: goldband-ship$' "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"
test "$(sed -n '1p' "$TMP_HOME/.claude/commands/goldband-language.md")" = "---"
grep -q '提問、建議、選項、摘要與指令說明語言' "$TMP_HOME/.claude/commands/goldband-language.md"
grep -q '^  系統化除錯與根因調查。$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q 'workflow-config get goldband_language' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q 'GOLDBAND_LANGUAGE:' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '支援 `zh-TW` 與 `en`' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '\$HOME/.codex/skills/workflow' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '\.agents/skills/workflow' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
if grep -q "~/.claude/skills/$LEGACY_RUNTIME_NAME" "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi
if grep -q "\$HOME/.codex/skills/$LEGACY_RUNTIME_NAME" "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi
if grep -q ".agents/skills/$LEGACY_RUNTIME_NAME" "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"; then
  exit 1
fi

HOME="$TMP_HOME" "$TMP_HOME/.claude/commands/scripts/set-goldband-language.sh" set en >/tmp/goldband-language-sync.log
grep -q '^  Systematic debugging and root-cause investigation.$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"

FAKE_BIN="$TMP_HOME/fake-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/fake-update" <<'EOF'
#!/usr/bin/env bash
echo "update:$1" >> "$HOME/launcher.log"
EOF
cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env bash
echo "claude:$*" >> "$HOME/launcher.log"
EOF
cat > "$FAKE_BIN/codex" <<'EOF'
#!/usr/bin/env bash
echo "codex:$*" >> "$HOME/launcher.log"
EOF
chmod +x "$FAKE_BIN/fake-update" "$FAKE_BIN/claude" "$FAKE_BIN/codex"
HOME="$TMP_HOME" PATH="$FAKE_BIN:$PATH" GOLDBAND_SELF_UPDATE_BIN="$FAKE_BIN/fake-update" bash <<'EOF'
source "$HOME/.claude/shell/goldband-launchers.sh"
claude alpha
codex beta
EOF
grep -q '^update:claude$' "$TMP_HOME/launcher.log"
grep -q '^claude:alpha$' "$TMP_HOME/launcher.log"
grep -q '^update:codex$' "$TMP_HOME/launcher.log"
grep -q '^codex:beta$' "$TMP_HOME/launcher.log"

git init --bare --initial-branch=main "$TMP_UPDATE_ORIGIN/origin.git" >/dev/null
git clone "$TMP_UPDATE_ORIGIN/origin.git" "$TMP_UPDATE_SEED/repo" >/dev/null 2>&1
git -C "$TMP_UPDATE_SEED/repo" config user.name "goldband-test"
git -C "$TMP_UPDATE_SEED/repo" config user.email "goldband@example.com"
echo "v1" > "$TMP_UPDATE_SEED/repo/README.md"
git -C "$TMP_UPDATE_SEED/repo" add README.md
git -C "$TMP_UPDATE_SEED/repo" commit -m "init" >/dev/null
git -C "$TMP_UPDATE_SEED/repo" push -u origin main >/dev/null
git clone "$TMP_UPDATE_ORIGIN/origin.git" "$TMP_UPDATE_WORK/repo" >/dev/null 2>&1
OLD_HEAD="$(git -C "$TMP_UPDATE_WORK/repo" rev-parse HEAD)"
git clone "$TMP_UPDATE_ORIGIN/origin.git" "$TMP_UPDATE_SEED/repo-next" >/dev/null 2>&1
git -C "$TMP_UPDATE_SEED/repo-next" config user.name "goldband-test"
git -C "$TMP_UPDATE_SEED/repo-next" config user.email "goldband@example.com"
echo "v2" >> "$TMP_UPDATE_SEED/repo-next/README.md"
git -C "$TMP_UPDATE_SEED/repo-next" commit -am "update" >/dev/null
git -C "$TMP_UPDATE_SEED/repo-next" push origin main >/dev/null
GOLDBAND_SELF_UPDATE_REPO_DIR="$TMP_UPDATE_WORK/repo" "$TMP_HOME/.claude/bin/goldband-self-update" >/tmp/goldband-self-update.log 2>&1
NEW_HEAD="$(git -C "$TMP_UPDATE_WORK/repo" rev-parse HEAD)"
test "$OLD_HEAD" != "$NEW_HEAD"
grep -q '\[goldband\] updated' /tmp/goldband-self-update.log

echo "[4/6] status output"
STATUS_OUTPUT="$(HOME="$TMP_HOME" "$TMP_ROOT/install.sh" status)"
echo "$STATUS_OUTPUT" | grep -q "workflow Claude install"
echo "$STATUS_OUTPUT" | grep -q "workflow Codex runtime (0.0.0-test)"
echo "$STATUS_OUTPUT" | grep -q "goldband wrapper language (en)"
echo "$STATUS_OUTPUT" | grep -q "shell launchers (zsh)"

echo "[5/6] verifier output"
VERIFIER_OUTPUT="$(HOME="$TMP_HOME" node "$TMP_ROOT/skills/global/claude-config-verification/scripts/verify-claude-config.js" --json)"
echo "$VERIFIER_OUTPUT" | grep -q '"claudeInstalled": true'
echo "$VERIFIER_OUTPUT" | grep -q '"codexInstalled": true'
echo "$VERIFIER_OUTPUT" | grep -q '"stateInstalled": true'
echo "$VERIFIER_OUTPUT" | grep -q '"codexVersion": "0.0.0-test"'
echo "$VERIFIER_OUTPUT" | grep -q '~/.codex/skills/goldband-\*'

echo "[6/6] language command flow docs"
grep -q '不要先讀目前設定' "$TMP_ROOT/commands/goldband-language.md"
grep -q '第一個提問固定用中英雙語短句' "$TMP_ROOT/commands/goldband-language.md"

echo "[OK] workflow integration smoke test passed"
