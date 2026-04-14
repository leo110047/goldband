#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0

check_contains() {
  local rel="$1"
  local pattern="$2"
  local label="$3"
  local file="$ROOT_DIR/$rel"

  if grep -Fq "$pattern" "$file"; then
    echo "[OK] $label"
  else
    echo "[FAIL] $label missing in $rel"
    EXIT_CODE=1
  fi
}

check_contains "AGENTS.md" "## Shared Decision Guidance" "repo shared decision guidance section"
check_contains "AGENTS.md" "failure containment" "repo guidance emphasizes decision quality over minimal delta"
check_contains "AGENTS.md" "main failure modes" "repo guidance requires failure modes"
check_contains "AGENTS.md" "prefer the healthiest maintainable path" "repo guidance defaults non-debug direction work to healthiest path"
check_contains "AGENTS.md" "default to the healthiest complete fix" "repo guidance defaults debugging toward the healthiest complete fix"
check_contains "AGENTS.md" "time pressure is the priority" "repo guidance allows narrower debugging fixes only under explicit time pressure"

if [ -f "$ROOT_DIR/ARCHITECTURE.md" ]; then
  echo "[OK] architecture boundary document exists"
else
  echo "[FAIL] ARCHITECTURE.md missing"
  EXIT_CODE=1
fi

check_contains "ARCHITECTURE.md" "## Responsibility Boundary" "architecture doc defines responsibility boundary"
check_contains "ARCHITECTURE.md" "## Integration Contract" "architecture doc defines integration contract"
check_contains "ARCHITECTURE.md" "vendor/workflow owns" "architecture doc explains workflow ownership"

check_contains "codex/AGENTS.md" "## Decision Recommendation Standard" "codex decision recommendation section"
check_contains "codex/AGENTS.md" "do not optimize for minimal code delta" "codex guidance rejects minimal-delta bias for recommendations"
check_contains "codex/AGENTS.md" "default to the most complete and maintainable fix" "codex guidance defaults debugging toward the healthiest complete fix"
check_contains "codex/AGENTS.md" "default to the healthiest maintainable path" "codex guidance defaults non-debug direction work to healthiest path"
check_contains "codex/AGENTS.md" "time pressure is the priority" "codex guidance allows narrower debugging fixes only under explicit time pressure"

check_contains "commands/discuss.md" "Failure Modes:" "discuss command requires failure modes"
check_contains "commands/discuss.md" "Switch Criteria:" "discuss command requires switch criteria"
check_contains "commands/discuss.md" "Unknowns to Verify:" "discuss command requires unknowns"

check_contains "commands/plan.md" "## Decision Check" "plan command includes decision check"
check_contains "commands/plan.md" "## Pre-Mortem" "plan command includes pre-mortem"
check_contains "commands/plan.md" "Fallback Path:" "plan command includes fallback path"

check_contains "skills/global/backend-patterns/SKILL.md" "## Recommendation Standard" "backend-patterns recommendation standard"
check_contains "skills/global/api-design/SKILL.md" "## Recommendation Standard" "api-design recommendation standard"
check_contains "skills/global/planning-workflow/SKILL.md" "## Decision-Quality Block" "planning-workflow decision-quality block"
check_contains "skills/global/decision-log/SKILL.md" "### Failure Signals" "decision-log failure signals section"
check_contains "skills/global/decision-log/SKILL.md" "### Revisit Triggers / Exit Criteria" "decision-log revisit triggers section"

check_contains "contexts/research.md" "When you recommend a direction" "research context recommendation guidance"
check_contains "README.md" "## goldband 與 workflow 的邊界" "README documents goldband workflow boundary"
check_contains "README.md" "decision recommendation standard" "README mentions decision recommendation standard"
check_contains "README.md" "預設優先健康且可維護的路徑" "README documents healthiest-path default"
check_contains "README.en.md" "## goldband vs workflow" "README.en documents goldband workflow boundary"
check_contains "README.en.md" "decision recommendation standard" "README.en mentions decision recommendation standard"
check_contains "README.en.md" "healthiest maintainable path" "README.en documents healthiest-path default"
check_contains "commands/verify-config.md" "scripts/verify-decision-guidance.sh" "verify-config documents decision guidance check"

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[OK] decision guidance checks passed"
fi

exit "$EXIT_CODE"
