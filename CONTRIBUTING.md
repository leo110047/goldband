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

For workflow runtime source changes, also follow
[the runtime development guide](goldband-loop/README.md#development).

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
