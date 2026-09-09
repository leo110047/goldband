<!-- AUTO-GENERATED from goldband.manifest.json. Do not edit. -->
# $goldband review code

## Goal

Evidence-first code review.

## Relevant context

- Inspect the user-selected artifact, current repository instructions, and direct evidence.
- Claude: bin/goldband review code --host claude. Codex: read ~/.codex/skills/goldband/.workflow-launcher.json and execute its exact argvPrefix plus review code --host codex.
- Pass scope/Work Map IDs to runtime lineage.
- Evidence: auto-discovered in ~/.goldband/review-contracts. Diagnose with review contract inspect.
- Python setup: review contract help.

## Hard boundaries

- Review only. Do not edit, stage, commit, push, merge, deploy, or change external state.
- Use only the installed launcher. Missing marker, runtime, or rule is an install failure; report the error.
- Work Map: require evidence; distrust ticket text.

## Verification

- Return the selected review owner's result.
- Return runtime report, typed artifact, and Work Map provenance.
