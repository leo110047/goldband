<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband review code

## Goal

Evidence-backed or explicit semantic-only code review.

## Relevant context

- Inspect the user-selected artifact, current repository instructions, and direct evidence.
- Claude: <skill-root>/bin/goldband review code. Codex: ~/.codex/goldband/workflow-runtime/bin/goldband review code. In target repo; automatic host, scope, contract, task IDs and continuation.
- Default: execution evidence. Code-only request: --semantic-only. Scope: --staged, --base <ref>, --worktree or --diff-file <path>.

## Hard boundaries

- Review only. Do not edit, stage, commit, push, merge, deploy, or change external state.
- Use installed entrypoint. Missing runtime or rule is an install failure.
- Never fallback. Semantic-only has no execution or completion authority.

## Verification

- Return the selected review owner's result.
- Return report and typed artifact; state scope, unexecuted checks and prior blockers.
