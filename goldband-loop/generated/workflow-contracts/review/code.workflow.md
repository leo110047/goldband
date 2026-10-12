<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband review code

## Goal

Independent read-only semantic code review.

## Relevant context

- Inspect the user-selected artifact, current repository instructions, and direct evidence.
- Claude: <skill-root>/bin/goldband review code. Codex: ~/.codex/goldband/workflow-runtime/bin/goldband review code. Run in the target repository.
- Default: current worktree. Narrow with --staged, --base <ref> or --diff-file <path>.

## Hard boundaries

- Review only. Do not edit, stage, commit, push, merge, deploy, or change external state.
- Use the installed entrypoint. Missing runtime or rule is an install failure.
- Semantic review does not run tests, authorize completion, or change task state.

## Verification

- Return the selected review owner's result.
- Return findings and scope. State unexecuted checks and inaccessible context.
