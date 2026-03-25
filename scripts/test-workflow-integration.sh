#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d /tmp/goldband-workflow-home.XXXXXX)"
TMP_WORKFLOW="$(mktemp -d /tmp/goldband-workflow-repo.XXXXXX)"
TMP_ROOT="$(mktemp -d /tmp/goldband-workflow-root.XXXXXX)"
trap 'rm -rf "$TMP_HOME" "$TMP_WORKFLOW" "$TMP_ROOT"' EXIT

mkdir -p \
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
EOF
done

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
cp -R "$ROOT_DIR/codex" "$TMP_ROOT/codex"
cp -R "$ROOT_DIR/.claude-plugin" "$TMP_ROOT/.claude-plugin"
cp -R "$TMP_WORKFLOW" "$TMP_ROOT/vendor/workflow"
chmod +x "$TMP_ROOT/install.sh"

echo "[1/5] skill checks"
"$ROOT_DIR/scripts/check-skills.sh"

echo "[2/5] installer smoke"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow >/tmp/goldband-workflow-install.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" workflow-codex >/tmp/goldband-workflow-codex.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" all-with-workflow >/tmp/goldband-all-with-workflow.log

echo "[3/5] verify symlinks"
test -L "$TMP_HOME/.claude/skills/workflow"
test -L "$TMP_HOME/.codex/skills/workflow"
test -f "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
test -f "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
test -f "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"
test ! -e "$TMP_HOME/.claude/skills/review"
test ! -e "$TMP_HOME/.codex/skills/workflow-review"
test ! -e "$TMP_HOME/.codex/skills/gstack"
test ! -e "$TMP_HOME/.codex/skills/goldband-gstack-upgrade"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.claude/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.claude/skills/goldband-review/SKILL.md"
grep -q '^name: goldband-qa$' "$TMP_HOME/.claude/skills/goldband-qa/SKILL.md"
grep -q '^name: goldband-ship$' "$TMP_HOME/.claude/skills/goldband-ship/SKILL.md"
grep -q '^name: goldband-browse$' "$TMP_HOME/.claude/skills/goldband-browse/SKILL.md"
grep -q '^name: goldband-investigate$' "$TMP_HOME/.codex/skills/goldband-investigate/SKILL.md"
grep -q '^name: goldband-review$' "$TMP_HOME/.codex/skills/goldband-review/SKILL.md"
grep -q '^name: goldband-qa$' "$TMP_HOME/.codex/skills/goldband-qa/SKILL.md"
grep -q '^name: goldband-ship$' "$TMP_HOME/.codex/skills/goldband-ship/SKILL.md"

echo "[4/5] status output"
STATUS_OUTPUT="$(HOME="$TMP_HOME" "$TMP_ROOT/install.sh" status)"
echo "$STATUS_OUTPUT" | grep -q "workflow Claude install"
echo "$STATUS_OUTPUT" | grep -q "workflow Codex runtime"

echo "[5/5] verifier output"
VERIFIER_OUTPUT="$(HOME="$TMP_HOME" node "$TMP_ROOT/skills/global/claude-config-verification/scripts/verify-claude-config.js" --json)"
echo "$VERIFIER_OUTPUT" | grep -q '"claudeInstalled": true'
echo "$VERIFIER_OUTPUT" | grep -q '"codexInstalled": true'
echo "$VERIFIER_OUTPUT" | grep -q '~/.codex/skills/goldband-\*'

echo "[OK] workflow integration smoke test passed"
