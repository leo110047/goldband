# Coding Style

This rule file is split into enforceable checks and advisory engineering
guidance. Enforceable checks are implemented by `scripts/check-code-style.mjs`
and may block commits only when the optional goldband global git hooks are
installed explicitly with `./install.sh style-gate`.

## Enforceable Gate

The numeric defaults below are maintainability guardrails, not universal proof
of correctness. Repositories may tune them consistently for their domain, but
must not raise a threshold or add a bypass only to make one change pass.

| Rule | Default | Tool |
|---|---:|---|
| Code file length | `GOLDBAND_MAX_FILE_LINES=600` | `check-code-style.mjs` |
| JS/TS function length | `GOLDBAND_MAX_FN_LINES=50` | Biome `noExcessiveLinesPerFunction` |
| JS/TS cognitive complexity | `GOLDBAND_MAX_COMPLEXITY=12` | Biome `noExcessiveCognitiveComplexity` |
| JS/TS function parameters | `GOLDBAND_MAX_PARAMS=4` | Biome `useMaxParams` |
| JS/TS unused imports and variables | n/a | Biome `noUnusedImports` / `noUnusedVariables` |
| Formatter drift | n/a | Biome formatter |
| Merge conflict blocks | n/a | `check-code-style.mjs` |
| High-confidence secrets | n/a | shared hook-router `secret-patterns` |
| Sensitive files | n/a | path gate for `.env`, keys, OS noise, generated deps |
| Large text/binary files | text 1 MB, binary 512 KB; declared generated text up to 16 MB | `check-code-style.mjs` |
| Escape hatches | n/a | staged added-line scan |
| Focused tests | n/a | staged added-line scan |
| Skipped tests | n/a | staged added-line scan |
| `debugger` and non-CLI `console.log` | n/a | staged added-line scan |

Currently blocked escape hatches:

- `@ts-ignore`
- `@ts-nocheck`
- `as unknown as`
- `biome-ignore`
- whole-file `eslint-disable`

### Large generated text contract

The 1 MB text limit remains the default. A repository may declare a larger
generated text artifact in a tracked `.goldband-style.json` file:

```json
{
  "schemaVersion": 1,
  "largeGeneratedTextFiles": [
    {
      "path": "api/openapi-snapshot.json",
      "generator": "scripts/generate-openapi.mjs",
      "maxBytes": 8388608
    }
  ]
}
```

This is a narrow ownership exception, not a general size bypass:

- `path` and `generator` are exact normalized repo-relative paths; globs are
  rejected.
- The config, artifact, and generator must all be tracked in the Git index.
- `maxBytes` must exceed the ordinary text limit and cannot exceed
  `GOLDBAND_MAX_GENERATED_TEXT_FILE_BYTES` (16 MB by default).
- Files above their declared cap remain blocked.
- The declaration proves that the repository has named an authoritative
  generator owner. Generator freshness and reproducibility remain project/CI
  checks and must compare regenerated output when the project requires that
  guarantee.

Advisory-only checks for now:

- shell and Python function length heuristics
- explicit `any`
- `@ts-expect-error` without a useful reason
- missing Biome installation; zero-dependency checks still run

## Enforcement Surfaces

- The git style gate is opt-in and checks staged files before commit.
- The installed global hooks are materialized under
  `${XDG_CONFIG_HOME:-$HOME/.config}/goldband/git-hooks`; `core.hooksPath`
  never points at the Goldband source checkout.
- Manual and CI checks scan first-party tracked code.
- `goldband-loop` runs the same 50-line, complexity-12, and four-parameter
  rules through `lint:complexity`. Its existing debt is a checked-in vector by
  file and rule: a change may not worsen that sorted magnitude vector, and any reduction must
  update the baseline in the same review. The gate compares the candidate vector
  with the authoritative push-before SHA, merge-base, or parent of the most recent
  baseline-changing commit; missing Git history fails closed outside the one-time
  baseline bootstrap. The `off` level in its Biome config
  prevents duplicate diagnostics during `lint:source`; the dedicated gate
  explicitly activates and enforces all three rules. The vector is identity-free:
  simultaneous repairs can offset another function's regression, so reviewers
  must inspect baseline reductions until stable function identity is available.
- Claude and Codex PostToolUse checks are advisory; they do not block edits.
- `.goldband-no-style-gate` is a visible repository opt-out.
  `GOLDBAND_STYLE_GATE=0` is a logged temporary bypass.
- A repository-local `core.hooksPath`, such as Husky, overrides the global hook.

## Advisory Engineering Guidance

Follow the project's documentation conventions. Update existing documentation
when it fits; create a document when requested or needed for the task. File names
and locations alone are not a reason to block a write. For development servers,
choose a terminal/process mechanism that keeps logs accessible and supports
cleanup; tmux is optional.

Prefer:

- immutable updates over in-place mutation
- readable names over clever abbreviations
- explicit error handling at boundaries
- schema or typed validation for external input
- constants or configuration for repeated magic values
- high-cohesion files organized by feature or domain
- capability-based names for durable scripts, commands, environment variables,
  workflows, and output labels; avoid names tied to a temporary phase or one
  historical incident
- comments that state the invariant and why it exists instead of narrating a
  dated incident, temporary state, or one triggering example

Before marking work complete, verify that the relevant gate, test, or command
actually ran and covered the changed behavior.
