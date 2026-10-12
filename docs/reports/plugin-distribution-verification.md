# Plugin Distribution Verification

Date: 2026-07-06

## External Capability Verification

| Capability | Evidence | Result |
| --- | --- | --- |
| Claude Code CLI version | `claude --version` -> `2.1.201 (Claude Code)` | Local verification used Claude Code 2.1.201. |
| Claude plugin management | `claude plugin --help` lists `install`, `list`, `marketplace`, `validate`, `details`, `enable`, `disable`, `uninstall`, `update`. | Claude Code has a first-class plugin CLI. |
| Claude plugin install scope | `claude plugin install --help` documents `--scope <scope>` with `user`, `project`, or `local`. | The clean-home verification uses `--scope user` inside a temp HOME. |
| Claude plugin validation | `claude plugin validate --help` documents validation and `--strict`. | Local validation is available before install. |
| Claude plugin assets | Official Claude Code plugin reference documents plugin directories, manifests, commands, skills, hooks, MCP servers, and marketplaces: https://code.claude.com/docs/en/plugins-reference | Claude plugin can carry the core Claude surface used here: commands, portable skills, generated rules skill, and hooks. |
| Claude marketplace install | Official marketplace docs document local marketplace files and `claude plugin marketplace add ./`: https://code.claude.com/docs/en/plugin-marketplaces | The repo exposes a local marketplace at `.claude-plugin/marketplace.json`. |
| Codex plugin ecosystem | Fresh Codex manual fetch succeeded at `/var/folders/xn/y420c5c516d3p0wx0gvtsyk40000gn/T/openai-docs-cache/codex-manual.md`; the manual describes Codex plugins as bundles of Codex skills, apps, and MCP servers, with local marketplace support. | Codex has a separate portable plugin package under `plugin-assets/codex-plugin/`; Codex full setup remains `install.sh codex-full`. |

Codex note: the decision to keep Codex on `install.sh` is not based on Codex
lacking plugins. It is a distribution-scope decision. The Codex-specific plugin
now carries the portable subset that Codex plugins are intended to carry:
portable skills plus opt-in MCP configuration. It must not be documented as
replacing `install.sh codex-full` until the remaining host-level Codex contract
is supported and verified.

## Asset Scope

Included in `goldband@goldband`:

- `commands/*.md`
- portable skills from `skills/global/`
- generated `goldband-rules` skill built from `rules/*.md`
- hook router config generated from `hooks/hooks.json`, rewritten to use `${CLAUDE_PLUGIN_ROOT}`
- hook scripts under `hooks/scripts/`

Excluded from the plugin:

- `goldband-loop/`
- Playwright, browser, iOS, and workflow runtime dependencies
- Codex config/rules/hooks/requirements
- public marketplace submission

Codex full setup remains installer-managed and currently includes:

- `codex/config.toml` (initial defaults only; existing user files preserved)
- `codex/requirements.toml` (separate explicit install; not part of core/full)
- `codex/rules/`
- `codex/hooks.json`
- `codex/hooks/`
- `codex/profiles/`
- `codex/permission-profiles/`
- `codex/agents/`
- Goldband Loop runtime assets installed for Codex

Optional installer targets are `claude-statusline` (the script in
`hooks/statusline-command.sh`) and `codex-statusline` (the preset in
`codex/statusline.toml`). Neither is enabled by core/full installation, hooks
installation, or background refresh. Explicitly applying a preset replaces the
current layout only; Codex adds no unrelated defaults. Its explicit TOML rewrite
can remove comments, so both hosts retain two personal-config backups (`.bak`,
`.bak.previous`). Refresh preserves user customization. These are
installer components, not plugin settings. `npm run test:config-preservation`
covers both hosts, the actual local Git self-update path, component failure
isolation, security-default advice, bounded backups, and ownership-aware uninstall.

Those assets are intentionally outside this Claude plugin package. The Codex
plugin owns only the portable subset documented in
`docs/reports/app-support-verification.md`; `install.sh codex-full` remains the
canonical full setup.

Generated artifacts:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugin-assets/claude-code-plugin/`
- `docs/reports/plugin-expected-assets.json`
- `hooks/plugin-hooks.json`

Source of truth:

- `commands/`
- `rules/`
- `hooks/`
- `skills/global/`
- `scripts/lib/plugin-distribution.mjs`
- `scripts/lib/app-support-distribution.mjs` for Codex plugin and Claude app
  adapter artifacts

Do not hand-edit generated plugin assets. Run:

```bash
node scripts/sync-plugin-assets.mjs
```

## Machine-Readable Expected Assets

Expected asset list:

```text
docs/reports/plugin-expected-assets.json
```

It is used by:

- `node scripts/sync-plugin-assets.mjs --check`
- `node scripts/check-plugin-distribution.mjs`

The verifier compares installed commands, skills, hooks, runtime dependencies,
and command helper paths against this JSON. It also executes the packaged hook
entrypoints from the generated plugin root and, when Claude CLI is available,
from the temp-HOME installed plugin cache. It fails if the plugin cache includes
`goldband-loop/`.

CI runs both the structural `--skip-cli` check and the full Claude CLI check.
The full gate installs Claude Code with
`npm install -g @anthropic-ai/claude-code`, then runs
`npm run test:plugin-distribution`, so manifest/schema regressions are covered by
`claude plugin validate` and temp-HOME plugin install instead of only JSON parse
and drift checks.

## Verification Output

Commands run on 2026-07-06:

```bash
node scripts/sync-plugin-assets.mjs
node scripts/check-plugin-distribution.mjs
claude plugin validate plugin-assets/claude-code-plugin
claude plugin validate --strict plugin-assets/claude-code-plugin
npm run test:plugin-distribution
```

Results:

- `node scripts/sync-plugin-assets.mjs` -> `[OK] plugin distribution artifacts synced`
- `node scripts/check-plugin-distribution.mjs` -> `[OK] plugin distribution check passed`
- `npm run test:plugin-distribution` -> `[OK] plugin distribution check passed`
- Clean temp HOME install inside `check-plugin-distribution.mjs`:
  - `claude plugin marketplace add ./` succeeded.
  - `claude plugin install goldband@goldband --scope user` succeeded.
  - `claude plugin list --json` returned enabled plugin `goldband@goldband` version `0.1.0`.
  - Installed plugin had no `errors` field.
  - Installed command, skill, and hook lists matched `plugin-expected-assets.json`.
  - Packaged `hook-router.js` and `skill-activation-suggestions.js` executed
    from the installed plugin cache without `MODULE_NOT_FOUND`.
  - Packaged `/goldband-language` command no longer hardcodes
    `~/.claude/commands/scripts/set-goldband-language.sh set`.
  - Installed plugin cache did not contain `goldband-loop/`.
- `claude plugin validate plugin-assets/claude-code-plugin` passed.
- `claude plugin validate --strict plugin-assets/claude-code-plugin` passed.
- `claude plugin details goldband@goldband` after temp-HOME install reported:
  - Skills/components: 24 visible entries, including portable skills plus slash
    commands.
  - Hooks: 11 events.
  - MCP servers: 0.
  - LSP servers: 0.

Important failed probes fixed during implementation:

- Root marketplace source `./` installed the repo root and would include
  `goldband-loop/`; the marketplace now points to
  `./plugin-assets/claude-code-plugin`.
- Manifest `hooks: "./hooks/hooks.json"` duplicated Claude's default
  `hooks/hooks.json` auto-load; the manifest now omits `hooks` and relies on the
  standard path.
- Packaged hooks initially failed with
  `MODULE_NOT_FOUND: '../../../../scripts/lib/telemetry-schema.cjs'`; the plugin
  now packages `scripts/lib/telemetry-schema.cjs`, and
  `check-plugin-distribution.mjs` executes the generated and installed hook
  entrypoints instead of only checking file existence.
- `cross-review-gate.js` still references Goldband Loop for installer/runtime
  installs, but plugin-only installs no-op that optional gate when
  `goldband-loop/cross-review/core.cjs` is absent. The plugin still excludes
  `goldband-loop/`.
- `/goldband-language` initially pointed at the installer command helper. It
  now checks the plugin-bundled helper first and executes helpers with `bash`
  so plugin installs do not need installer-managed commands.

## Dual-Path Status Verification

Plugin-only temp HOME:

```text
goldband@goldband plugin (0.1.0) -> temp ~/.claude/plugins/cache/...
plugin 與 installer 沒有偵測到 duplicate core asset
EXIT:0
```

Plugin plus installer-managed Claude assets temp HOME:

```text
plugin 與 installer 同時提供 core asset: commands,rules,hooks,skills
active source: goldband@goldband plugin + installer-managed Claude files
建議: 外部使用者保留 plugin 並執行 ./install.sh uninstall；開發者保留 installer 時執行 claude plugin uninstall goldband@goldband。
EXIT:2
```

This satisfies the duplicate-status contract: duplicate assets are not reported
as all green.

## Uninstall

Plugin uninstall:

```bash
claude plugin uninstall goldband@goldband
```

Installer uninstall:

```bash
./install.sh uninstall
```

These paths are independent. `./install.sh uninstall` removes installer-managed
files and does not uninstall the Claude plugin. `claude plugin uninstall`
removes the plugin and does not remove installer-managed files.

## Marketplace TODO

Not done in this implementation:

- Publish to a public Claude Code marketplace.
- Add signed release tags or hosted plugin zip artifacts.
- Prove that a Codex plugin can replace the host-level Codex setup currently
  owned by `install.sh codex-full`.
- Automate remote marketplace update/upgrade flow.

Before public publishing:

1. Decide release versioning for `goldband@goldband`.
2. Add release notes and compatibility policy.
3. Run `claude plugin validate --strict plugin-assets/claude-code-plugin`.
4. Test install from the exact hosted marketplace source, not only local `./`.
5. Update README install commands from local marketplace install to public
   marketplace install.
