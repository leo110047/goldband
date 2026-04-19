import type { TemplateContext } from '../types';
import { getHostConfig } from '../../../hosts/index';

export function generatePreambleBash(ctx: TemplateContext): string {
  const hostConfig = getHostConfig(ctx.host);
  const runtimeRoot = hostConfig.usesEnvVars
    ? `_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
WORKFLOW_ROOT="$HOME/${hostConfig.globalRoot}"
[ -n "$_ROOT" ] && [ -d "$_ROOT/${ctx.paths.localSkillRoot}" ] && WORKFLOW_ROOT="$_ROOT/${ctx.paths.localSkillRoot}"
WORKFLOW_BIN="$WORKFLOW_ROOT/bin"
WORKFLOW_BROWSE="$WORKFLOW_ROOT/browse/dist"
WORKFLOW_DESIGN="$WORKFLOW_ROOT/design/dist"
`
    : '';

  return `## Preamble (run first)

\`\`\`bash
${runtimeRoot}_UPD=$(${ctx.paths.binDir}/workflow-update-check 2>/dev/null || ${ctx.paths.localSkillRoot}/bin/workflow-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
mkdir -p ~/.workflow/sessions
touch ~/.workflow/sessions/"$PPID"
_SESSIONS=$(find ~/.workflow/sessions -mmin -120 -type f 2>/dev/null | wc -l | tr -d ' ')
find ~/.workflow/sessions -mmin +120 -type f -exec rm {} + 2>/dev/null || true
_PROACTIVE=$(${ctx.paths.binDir}/workflow-config get proactive 2>/dev/null || echo "true")
_PROACTIVE_PROMPTED=$([ -f ~/.workflow/.proactive-prompted ] && echo "yes" || echo "no")
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
_SKILL_PREFIX=$(${ctx.paths.binDir}/workflow-config get skill_prefix 2>/dev/null || echo "false")
echo "PROACTIVE: $_PROACTIVE"
echo "PROACTIVE_PROMPTED: $_PROACTIVE_PROMPTED"
echo "SKILL_PREFIX: $_SKILL_PREFIX"
source <(${ctx.paths.binDir}/workflow-repo-mode 2>/dev/null) || true
REPO_MODE=\${REPO_MODE:-unknown}
echo "REPO_MODE: $REPO_MODE"
_LAKE_SEEN=$([ -f ~/.workflow/.completeness-intro-seen ] && echo "yes" || echo "no")
echo "LAKE_INTRO: $_LAKE_SEEN"
_TEL=$(${ctx.paths.binDir}/workflow-config get telemetry 2>/dev/null || true)
_TEL_PROMPTED=$([ -f ~/.workflow/.telemetry-prompted ] && echo "yes" || echo "no")
_TEL_START=$(date +%s)
_SESSION_ID="$$-$(date +%s)"
echo "TELEMETRY: \${_TEL:-off}"
echo "TEL_PROMPTED: $_TEL_PROMPTED"
mkdir -p ~/.workflow/analytics
if [ "$_TEL" != "off" ]; then
echo '{"skill":"${ctx.skillName}","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}'  >> ~/.workflow/analytics/skill-usage.jsonl 2>/dev/null || true
fi
# zsh-compatible: use find instead of glob to avoid NOMATCH error
for _PF in $(find ~/.workflow/analytics -maxdepth 1 -name '.pending-*' 2>/dev/null); do
  if [ -f "$_PF" ]; then
    if [ "$_TEL" != "off" ] && [ -x "${ctx.paths.binDir}/workflow-telemetry-log" ]; then
      ${ctx.paths.binDir}/workflow-telemetry-log --event-type skill_run --skill _pending_finalize --outcome unknown --session-id "$_SESSION_ID" 2>/dev/null || true
    fi
    rm -f "$_PF" 2>/dev/null || true
  fi
  break
done
# Learnings count
eval "$(${ctx.paths.binDir}/workflow-slug 2>/dev/null)" 2>/dev/null || true
_LEARN_FILE="\${WORKFLOW_HOME:-$HOME/.workflow}/projects/\${SLUG:-unknown}/learnings.jsonl"
if [ -f "$_LEARN_FILE" ]; then
  _LEARN_COUNT=$(wc -l < "$_LEARN_FILE" 2>/dev/null | tr -d ' ')
  echo "LEARNINGS: $_LEARN_COUNT entries loaded"
  if [ "$_LEARN_COUNT" -gt 5 ] 2>/dev/null; then
    ${ctx.paths.binDir}/gstack-learnings-search --limit 3 2>/dev/null || true
  fi
else
  echo "LEARNINGS: 0"
fi
# Session timeline: record skill start (local-only, never sent anywhere)
${ctx.paths.binDir}/workflow-timeline-log '{"skill":"${ctx.skillName}","event":"started","branch":"'"$_BRANCH"'","session":"'"$_SESSION_ID"'"}' 2>/dev/null &
# Check if CLAUDE.md has routing rules
_HAS_ROUTING="no"
if [ -f CLAUDE.md ] && grep -q "## Skill routing" CLAUDE.md 2>/dev/null; then
  _HAS_ROUTING="yes"
fi
_ROUTING_DECLINED=$(${ctx.paths.binDir}/workflow-config get routing_declined 2>/dev/null || echo "false")
echo "HAS_ROUTING: $_HAS_ROUTING"
echo "ROUTING_DECLINED: $_ROUTING_DECLINED"
# Vendoring deprecation: detect if CWD has a vendored gstack copy
_VENDORED="no"
if [ -d ".claude/skills/workflow" ] && [ ! -L ".claude/skills/workflow" ]; then
  if [ -f ".claude/skills/workflow/VERSION" ] || [ -d ".claude/skills/workflow/.git" ]; then
    _VENDORED="yes"
  fi
fi
echo "VENDORED_GSTACK: $_VENDORED"
echo "MODEL_OVERLAY: ${ctx.model ?? 'none'}"
# Checkpoint mode (explicit = no auto-commit, continuous = WIP commits as you go)
_CHECKPOINT_MODE=$(${ctx.paths.binDir}/workflow-config get checkpoint_mode 2>/dev/null || echo "explicit")
_CHECKPOINT_PUSH=$(${ctx.paths.binDir}/workflow-config get checkpoint_push 2>/dev/null || echo "false")
echo "CHECKPOINT_MODE: $_CHECKPOINT_MODE"
echo "CHECKPOINT_PUSH: $_CHECKPOINT_PUSH"
# Detect spawned session (OpenClaw or other orchestrator)
[ -n "$OPENCLAW_SESSION" ] && echo "SPAWNED_SESSION: true" || true${ctx.host === 'gbrain' || ctx.host === 'hermes' ? `
# GBrain health check (gbrain/hermes host only)
if command -v gbrain &>/dev/null; then
  _BRAIN_JSON=$(gbrain doctor --fast --json 2>/dev/null || echo '{}')
  _BRAIN_SCORE=$(echo "$_BRAIN_JSON" | grep -o '"health_score":[0-9]*' | cut -d: -f2)
  _BRAIN_FAILS=$(echo "$_BRAIN_JSON" | grep -o '"status":"fail"' | wc -l | tr -d ' ')
  _BRAIN_WARNS=$(echo "$_BRAIN_JSON" | grep -o '"status":"warn"' | wc -l | tr -d ' ')
  echo "BRAIN_HEALTH: \${_BRAIN_SCORE:-unknown} (\${_BRAIN_FAILS:-0} failures, \${_BRAIN_WARNS:-0} warnings)"
  if [ "\${_BRAIN_SCORE:-100}" -lt 50 ] 2>/dev/null; then
    echo "$_BRAIN_JSON" | grep -o '"name":"[^"]*","status":"[^"]*","message":"[^"]*"' || true
  fi
fi` : ''}
\`\`\``;
}

