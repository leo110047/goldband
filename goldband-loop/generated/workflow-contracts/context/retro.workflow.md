<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband context retro

## Goal

Summarize recent work and lessons.

## Relevant context

- Use current git state and the newest relevant saved artifacts for this repository and branch.
- From the installed Goldband runtime root containing this contract, run `bin/goldband-retro evidence --host claude`, adding `--session <id>` for a session other than the current one. It prints the measured report, facet coverage, and the session record path; record N is line N+1.
- Judge `inferred` causes only from the cited records: unused reads, missing path guidance, hidden file dependencies, cheaper commands, MCP settings, tools to retire.

## Hard boundaries

- Do not fabricate missing history or treat stale artifacts as current evidence.
- Report `unavailable` facets as not covered. Keep measured values and inferences in separate sections and phrase inferences as such. Without evidence, state that the cause is unknown.
- Never copy prompts, tool output, or file content into proposals. Proposals only become knowledge candidates; do not edit instructions, rules, hooks, or configuration.

## Verification

- Identify the artifact used, distinguish saved context from current state, and state the next actionable step.
- Write a JSON file with `sessionId`, `sha256`, and `proposals` (`facet`, `rule`, `severity`, `target`, `summary`, `practice`, `context`, `refs`, `estimatedBytes` for path guidance, `evidence` graded `inferred`), run `bin/goldband-retro propose --input <file>`, and report each written, duplicate, or rejected result. With no proposal worth adopting, skip propose and say so.

## Runtime contract

Modes and required inputs:

- `evidence`: `mode`
- `propose`: `mode`, `sessionId`, `sha256`, `proposals`

Outputs: `retro-report`, `facet-coverage`, `candidate-outcomes`.

Side effects:

- `local-retro-report-write`: `runtime-owner`
- `local-knowledge-candidate-write`: `runtime-owner`
