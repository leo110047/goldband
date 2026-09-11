<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband review code

## Goal

Evidence-backed or explicit semantic-only code review.

## Relevant context

- Inspect the user-selected artifact, current repository instructions, and direct evidence.
- Claude: bin/goldband review code --host claude. Codex: read ~/.codex/skills/goldband/.workflow-launcher.json and execute its exact argvPrefix plus review code --host codex.
- 只看程式: --semantic-only, no manifest or test setup. 包含執行驗證: default mode; pass Work Map IDs when applicable.

## Hard boundaries

- Review only. Do not edit, stage, commit, push, merge, deploy, or change external state.
- Use installed launcher. Missing marker, runtime, or rule is an install failure.
- Never fallback. Semantic-only: no providers, receipts, closure, Work Map or completion authority.

## Verification

- Return the selected review owner's result.
- Return report and typed artifact; state scope, unexecuted checks and prior blockers.
