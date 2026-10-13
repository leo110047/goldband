# Contributing to Goldband Loop

Goldband Loop exposes one capability interface:

- Claude Code: `/goldband <capability> <action>`
- Codex: `$goldband <capability> <action>`

`../goldband.manifest.json` is the source of truth for capabilities, actions,
prompt contracts, manual routing, and runtime metadata. Do not add a top-level
skill or command for an individual workflow.

## Development setup

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband/goldband-loop
bun install
bun run build
```

Use a full clone when contributing so history-based review and debugging work.
`bin/dev-setup` can point a development checkout at the local runtime;
`bin/dev-teardown` restores the normal installation.

## Changing a workflow

1. Edit the action in `../goldband.manifest.json`.
2. Keep its prompt contract limited to goal, relevant context, hard boundaries,
   and verification.
3. Put deterministic execution, validation, state, and safety behavior in the
   runtime rather than prompt prose.
4. Regenerate the derived surfaces.
5. Run the focused workflow and install checks.

```bash
cd ..
node scripts/generate-goldband-surfaces.mjs
node scripts/test-workflow-contracts.mjs
cd goldband-loop
bun run typecheck
bun run test:workflows
```

Generated files under `generated/workflow-contracts/`,
`generated/capability-actions.json`, `workflows/capability-registry.generated.ts`,
and the root `SKILL.md` must not be edited by hand. The root `SKILL.md.tmpl` is
only the small capability router; it is not a workflow template system.

## Changing runtime code

- Keep host and provider boundaries behind adapters.
- Validate required data before side effects.
- Keep compatibility workflows fail-closed when real execution is unsupported.
- Add deterministic regression coverage for contract changes.
- Use `bun run check:source` before handing off production TypeScript changes.

Compiled CLI changes (`design`, `make-pdf`) require `bun run build`.

## Installing for verification

Run installer checks under a temporary `HOME`; do not overwrite a developer's
active global runtime during tests.

```bash
cd ..
node scripts/check-goldband-loop-inventory.mjs
bash scripts/test-workflow-integration.sh
```

The standard installer exposes the root capability router and thin internal
workflow contracts. It also removes Goldband-managed top-level workflow entries
left by older installs. Historical flat workflow names are not aliases.

## Pull requests

Keep generated surfaces in the same change as their manifest source. Report the
exact checks run, distinguish mock from real-host verification, and do not claim
Claude/Codex parity unless both installation surfaces were exercised.
