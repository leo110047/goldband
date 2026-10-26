<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband context retro

## Goal

Summarize recent work and lessons.

## Relevant context

- Use current git state and the newest relevant saved artifacts for this repository and branch.
- From the Goldband runtime root containing this contract, run `bin/goldband-retro evidence --host claude` for the current session, `--session <id>`, or `--days <N>` (this repository, last N days). Record N is line N+1 of the record path.
- Infer only from cited records: unused reads, cheaper commands or MCP, whether a deterministic check could catch an error (`mechanical`) or not (`judgement`), failure causes, and whether a repeated instruction restates another, a hook or gate, or host defaults.

## Hard boundaries

- Do not fabricate missing history or treat stale artifacts as current evidence.
- Report `unavailable` facets as not covered. Label inferences apart from measurements; without evidence, say the cause is unknown.
- Never copy prompts, tool output, or file content into proposals, which only become knowledge candidates. Edit no instructions, rules, hooks, or settings; propose only read-only access, never secrets. Instruction removal stays `unproven` until a user-started eval.

## Verification

- Identify the artifact used, distinguish saved context from current state, and state the next actionable step.
- Per snapshot, write JSON with `sessionId`, `sha256`, and `proposals` (`facet`, `rule`, `severity`, `target`, `summary`, `practice`, `context`, `refs`, `estimatedBytes` for path guidance, `checkClass` for auto-checks, `inferred` `evidence`), run `bin/goldband-retro propose --input <file>`, and report each outcome, or say nothing is worth adopting.

## Runtime contract

Modes and required inputs:

- `evidence`: `mode`
- `propose`: `mode`, `sessionId`, `sha256`, `proposals`

Outputs: `retro-report`, `facet-coverage`, `candidate-outcomes`.

Side effects:

- `local-retro-report-write`: `runtime-owner`
- `local-knowledge-candidate-write`: `runtime-owner`
