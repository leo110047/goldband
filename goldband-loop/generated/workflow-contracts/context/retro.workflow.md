<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband context retro

## Goal

Summarize recent work and lessons.

## Relevant context

- Use current git state and the newest relevant saved artifacts for this repository and branch.
- From the installed Goldband runtime root containing this contract, run `bin/goldband-retro evidence --host claude` for the current session, `--session <id>`, or `--days <N>` (this repository, last N days). Record N is line N+1 of the record path.
- Infer causes only from cited records: unused reads, missing path guidance, cheaper commands or MCP settings, whether a deterministic check could catch an error (`mechanical`) or not (`judgement`), and failure causes (permission, auth, network, timeout).

## Hard boundaries

- Do not fabricate missing history or treat stale artifacts as current evidence.
- Report `unavailable` facets as not covered. Keep inferences apart from measured values and phrase them as such. Without evidence, say the cause is unknown.
- Never copy prompts, tool output, or file content into proposals; they only become knowledge candidates. Edit no instructions, rules, hooks, or settings. Propose read-only access only, never write access or secrets.

## Verification

- Identify the artifact used, distinguish saved context from current state, and state the next actionable step.
- Per snapshot, write JSON with `sessionId`, `sha256`, and `proposals` (`facet`, `rule`, `severity`, `target`, `summary`, `practice`, `context`, `refs`, `estimatedBytes` for path guidance, `checkClass` for auto-checks, `inferred` `evidence`), run `bin/goldband-retro propose --input <file>`, and report each outcome. With nothing worth adopting, skip propose and say so.

## Runtime contract

Modes and required inputs:

- `evidence`: `mode`
- `propose`: `mode`, `sessionId`, `sha256`, `proposals`

Outputs: `retro-report`, `facet-coverage`, `candidate-outcomes`.

Side effects:

- `local-retro-report-write`: `runtime-owner`
- `local-knowledge-candidate-write`: `runtime-owner`
