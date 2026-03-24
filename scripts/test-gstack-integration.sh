#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d /tmp/goldband-gstack-home.XXXXXX)"
TMP_GSTACK="$(mktemp -d /tmp/goldband-gstack-repo.XXXXXX)"
TMP_ROOT="$(mktemp -d /tmp/goldband-gstack-root.XXXXXX)"
trap 'rm -rf "$TMP_HOME" "$TMP_GSTACK" "$TMP_ROOT"' EXIT

mkdir -p \
  "$TMP_GSTACK/careful" \
  "$TMP_GSTACK/freeze" \
  "$TMP_GSTACK/review" \
  "$TMP_GSTACK/qa"

cat > "$TMP_GSTACK/VERSION" <<'EOF'
0.0.0-test
EOF

cat > "$TMP_GSTACK/SKILL.md" <<'EOF'
---
name: gstack
description: test fixture
---
EOF

for skill in careful freeze review qa; do
  cat > "$TMP_GSTACK/$skill/SKILL.md" <<EOF
---
name: $skill
description: test fixture
---
EOF
done

cat > "$TMP_GSTACK/setup" <<'EOF'
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
  rm -rf "$HOME/.claude/skills/gstack"
  ln -s "$ROOT" "$HOME/.claude/skills/gstack"
}

install_codex() {
  mkdir -p "$HOME/.codex/skills"
  rm -rf "$HOME/.codex/skills/gstack"
  ln -s "$ROOT" "$HOME/.codex/skills/gstack"
  for skill in review qa careful freeze; do
    target="$HOME/.codex/skills/gstack-$skill"
    rm -rf "$target"
    mkdir -p "$target"
    cat > "$target/SKILL.md" <<SKILL
---
name: gstack-$skill
description: generated test fixture
---
SKILL
  done
  printf '%s\n' "$VERSION" > "$HOME/.codex/skills/gstack/.installed-version"
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
chmod +x "$TMP_GSTACK/setup"

mkdir -p "$TMP_ROOT/vendor"
cp "$ROOT_DIR/install.sh" "$TMP_ROOT/install.sh"
cp "$ROOT_DIR/AGENTS.md" "$TMP_ROOT/AGENTS.md"
cp -R "$ROOT_DIR/skills" "$TMP_ROOT/skills"
cp -R "$ROOT_DIR/hooks" "$TMP_ROOT/hooks"
cp -R "$ROOT_DIR/commands" "$TMP_ROOT/commands"
cp -R "$ROOT_DIR/codex" "$TMP_ROOT/codex"
cp -R "$ROOT_DIR/.claude-plugin" "$TMP_ROOT/.claude-plugin"
cp -R "$TMP_GSTACK" "$TMP_ROOT/vendor/gstack"
chmod +x "$TMP_ROOT/install.sh"

echo "[1/5] skill checks"
"$ROOT_DIR/scripts/check-skills.sh"

echo "[2/5] installer smoke"
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" gstack >/tmp/goldband-gstack-install.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" gstack-codex >/tmp/goldband-gstack-codex.log
HOME="$TMP_HOME" "$TMP_ROOT/install.sh" all-with-gstack >/tmp/goldband-all-with-gstack.log

echo "[3/5] verify symlinks"
test -L "$TMP_HOME/.claude/skills/gstack"
test -L "$TMP_HOME/.codex/skills/gstack"
test -f "$TMP_HOME/.codex/skills/gstack-review/SKILL.md"

echo "[4/5] status output"
STATUS_OUTPUT="$(HOME="$TMP_HOME" "$TMP_ROOT/install.sh" status)"
echo "$STATUS_OUTPUT" | grep -q "gstack Claude install"
echo "$STATUS_OUTPUT" | grep -q "gstack Codex runtime"

echo "[5/5] verifier output"
VERIFIER_OUTPUT="$(HOME="$TMP_HOME" node "$TMP_ROOT/skills/global/claude-config-verification/scripts/verify-claude-config.js" --json)"
echo "$VERIFIER_OUTPUT" | grep -q '"claudeInstalled": true'
echo "$VERIFIER_OUTPUT" | grep -q '"codexInstalled": true'

echo "[OK] gstack integration smoke test passed"
