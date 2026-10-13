# Contributing

## Development Setup and Tests

From the repository root, install test dependencies and run the aggregate suite:

```bash
npm run bootstrap:test
npm test
```

Run bootstrap after cloning, changing lockfiles, or an installer migration. It
installs dependencies for the root, `mcp/server`, and `goldband-loop`, and cleans
retired generated assets only when their ownership is verified. `npm test`
checks the environment, runs the package-owned suites, and prints a per-suite
summary; it does not install dependencies. `bun run test` is an alternative
entrypoint. Bare `bun test` at the repo root bypasses that orchestration and
should not be used as repository verification.

List suites or select checks relevant to your change:

```bash
npm run test:repo:list
npm run test:plugin-distribution
npm run test:app-support
npm run test:hook-router
npm run test:cross-review
npm run lint:style
```


## Goldband Loop Runtime

Goldband Loop exposes one capability interface: Claude Code uses
`/goldband <capability> <action>` and Codex uses `$goldband <capability> <action>`.
`goldband.manifest.json` is the source of truth for capabilities, actions,
prompt contracts, manual routing, and runtime metadata. Individual workflows do
not get top-level skills or commands.

Use a full clone so history-based review and debugging work. Build the runtime
from `goldband-loop/`:

```bash
cd goldband-loop
bun install
bun run build
```

`bin/dev-setup` points a development checkout at the local runtime;
`bin/dev-teardown` restores the normal installation. Compiled CLI changes
(`design`, `make-pdf`) require `bun run build`.

### Changing a workflow

Edit the action in `goldband.manifest.json`. Its prompt contract states only the
goal, relevant context, hard boundaries, and verification; deterministic
execution, validation, state, and safety behavior belong in the runtime. Then
regenerate the derived surfaces and run the workflow checks:

```bash
node scripts/generate-goldband-surfaces.mjs
node scripts/test-workflow-contracts.mjs
cd goldband-loop && bun run typecheck && bun run test:workflows
```

`goldband-loop/generated/workflow-contracts/`,
`goldband-loop/generated/capability-actions.json`,
`goldband-loop/workflows/capability-registry.generated.ts`, and
`goldband-loop/SKILL.md` are generated and must not be edited by hand.
`goldband-loop/SKILL.md.tmpl` is only the capability router.

### Changing runtime code

Host and provider details stay behind adapters. Required data is validated
before side effects. Compatibility workflows fail closed when real execution is
unsupported. Contract changes need deterministic regression tests. Run
`bun run check:source` in `goldband-loop/` before handing off TypeScript
changes.

### Installer verification

Installer checks run under a temporary `HOME` and never overwrite the active
global runtime. Installed workflow entries are listed in
`goldband-loop/inventory.json`; update it with the entries.

```bash
node scripts/check-goldband-loop-inventory.mjs
bash scripts/test-workflow-integration.sh
```

The standard installer exposes the capability router and thin internal workflow
contracts, and removes Goldband-managed top-level workflow entries left by older
installs. Historical flat workflow names are not aliases.

## Plugin Distribution Changes

When changing any source asset that feeds the Claude Code plugin, regenerate the
plugin package before committing:

```bash
node scripts/sync-plugin-assets.mjs
npm run test:plugin-distribution
```

This applies to:

- `commands/`
- `rules/`
- `hooks/`
- `skills/global/`
- `scripts/lib/plugin-distribution.mjs`
- `scripts/lib/plugin-hook-summary.mjs`
- `scripts/check-plugin-distribution.mjs`

`npm run test:plugin-distribution` intentionally runs the full Claude CLI path:
manifest validation, local marketplace add, temp-HOME install, installed asset
diff, and packaged hook runtime smoke. Do not replace it with
`node scripts/check-plugin-distribution.mjs --skip-cli` for local pre-commit
verification; `--skip-cli` is only the structural CI fallback when the Claude
CLI path is being checked separately.

## Codex Plugin and Claude App Adapter Changes

After changing sources that feed these distributions, regenerate their assets
and verify the result:

```bash
npm run sync:app-support
npm run test:app-support
```

## Pull Requests

Generated surfaces change in the same commit as their source. Report the exact
checks run, distinguish mock from real-host verification, and claim Claude and
Codex parity only when both installation surfaces were exercised.
