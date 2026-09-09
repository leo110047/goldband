#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0

check_contains() {
  local rel="$1"
  local pattern="$2"
  local label="$3"
  local file="$ROOT_DIR/$rel"
  local normalized
  normalized="$(tr -s '[:space:]' ' ' < "$file")"

  if grep -Fq "$pattern" <<< "$normalized"; then
    echo "[OK] $label"
  else
    echo "[FAIL] $label missing in $rel"
    EXIT_CODE=1
  fi
}

if [ -f "$ROOT_DIR/ARCHITECTURE.md" ]; then
  echo "[OK] architecture boundary document exists"
else
  echo "[FAIL] ARCHITECTURE.md missing"
  EXIT_CODE=1
fi

check_contains "ARCHITECTURE.md" "## Responsibility Boundary" "architecture doc defines responsibility boundary"
check_contains "ARCHITECTURE.md" "## Integration Contract" "architecture doc defines integration contract"
check_contains "ARCHITECTURE.md" "goldband-loop owns" "architecture doc explains Goldband Loop ownership"
check_contains "ARCHITECTURE.md" "inventory gate" "architecture doc explains inventory gate"
check_contains "goldband-loop/inventory.json" "\"runtimeRoot\": \"goldband\"" "Goldband Loop inventory declares runtime root"

check_contains "skills/global/systematic-debugging/SKILL.md" "healthiest complete fix" "systematic-debugging skill keeps healthiest complete fix policy"
for rel in \
  "codex/AGENTS.md" \
  "rules/escalation.md" \
  "skills/global/systematic-debugging/SKILL.md" \
  "goldband.manifest.json"; do
  check_contains "$rel" "tool, sandbox, or permission failures" "fix-attempt exclusions remain explicit in $rel"
  check_contains "$rel" "different failure class or new evidence-backed hypothesis" "fix-attempt reset remains explicit in $rel"
done
for rel in "codex/AGENTS.md" "rules/escalation.md" "goldband.manifest.json"; do
  check_contains "$rel" "change the target, behavior, or external effect" "material ambiguity stays defined in $rel"
done
for rel in "codex/AGENTS.md" "rules/architecture-boundaries.md" "goldband.manifest.json"; do
  check_contains "$rel" "current request or product contract" "required surface scope stays explicit in $rel"
done
for rel in "codex/AGENTS.md" "rules/security.md" "goldband.manifest.json"; do
  check_contains "$rel" "controls matched to" "security controls stay threat-matched in $rel"
done
for rel in "codex/AGENTS.md" "rules/session-handoff.md" "goldband.manifest.json"; do
  check_contains "$rel" "lasting architectural or process consequences" "durable decision threshold stays explicit in $rel"
done
check_contains "goldband.manifest.json" '"prohibitedSharedBoilerplate"' "manifest declares prohibited shared prompt boilerplate"
check_contains "scripts/test-workflow-contracts.mjs" "legacy per-workflow prompt files remain" "workflow contract gate rejects legacy prompt files"

check_contains "commands/discuss.md" "Failure Modes:" "discuss command requires failure modes"
check_contains "commands/discuss.md" "Switch Criteria:" "discuss command requires switch criteria"
check_contains "commands/discuss.md" "Unknowns to Verify:" "discuss command requires unknowns"

check_contains "commands/plan.md" "## Decision Check" "plan command includes decision check"
check_contains "commands/plan.md" "## Pre-Mortem" "plan command includes pre-mortem"
check_contains "commands/plan.md" "Fallback Path:" "plan command includes fallback path"
check_contains "commands/plan.md" "Smallest Sufficient Option:" "plan command names the smallest sufficient option"
check_contains "commands/plan.md" "Evidence for Heavier Mechanism:" "plan command requires evidence for heavier mechanisms"
check_contains "commands/plan.md" "Permanent Cost:" "plan command surfaces permanent cost"

check_contains "skills/global/planning-workflow/SKILL.md" "## Decision-Quality Block" "planning-workflow decision-quality block"
check_contains "skills/global/planning-workflow/SKILL.md" "/plan" "planning-workflow defers full workflow planning"
check_contains "skills/global/planning-workflow/SKILL.md" "Smallest sufficient option and its permanent cost." "planning-workflow applies proportionality"
check_contains "skills/global/implementation-contracts/SKILL.md" "## Pre-Implementation Proportionality" "implementation-contracts applies proportionality before edits"
check_contains "rules/change-scope.md" "## Pre-Implementation Proportionality" "canonical change-scope policy owns the full proportionality contract"
check_contains "rules/change-scope.md" "Phase metadata expresses applicability, not deterministic enforcement." "canonical policy preserves the guidance boundary"
check_contains "skills/global/OPERATIONS.md" "recommendation 應附：assumptions、failure modes、warning signals、best alternative、unknowns" "operations docs keep decision recommendation guidance"
check_contains "skills/global/VALIDATION.md" "recommendation 沒有 assumptions / failure modes / alternatives" "validation docs flag missing decision-quality evidence"
check_contains "skills/global/security-checklist/SKILL.md" '$goldband review code' "security-checklist names the current review capability"
check_contains "skills/global/decision-log/reference/adr-template.md" "### Failure Signals" "decision-log failure signals section"
check_contains "skills/global/decision-log/reference/adr-template.md" "### Revisit Triggers / Exit Criteria" "decision-log revisit triggers section"

check_contains "commands/verify-config.md" "scripts/verify-decision-guidance.sh" "verify-config documents decision guidance check"

# README role/link checks and their negative regressions share the guidance test owner below.
node "$ROOT_DIR/scripts/test-change-scope-guidance.mjs" || EXIT_CODE=1

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[OK] decision guidance checks passed"
fi

exit "$EXIT_CODE"
