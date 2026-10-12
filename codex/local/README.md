# Machine-local Codex overlays

Files in this directory are intentionally ignored except for this README and
example files. Use them for machine-specific Codex state that should not become
part of goldband's portable baseline.

Supported local files:

- `config.toml`: machine defaults merged over `codex/config.toml` only when
  `~/.codex/config.toml` does not exist. Existing files are never merged.
- `rules/*.rules`: linked into `~/.codex/rules` alongside portable rules.

Keep reusable machine defaults and one-off command approvals here. Codex App
runtime state and later preference changes stay in `~/.codex/config.toml` and
are preserved by installation and updates.

`rules/default.rules` is the preferred writable overlay. The installer links the
portable baseline as the reserved `~/.codex/rules/goldband.rules` (updated even
in copy installations, after backing up an old copy) and this ignored overlay as
`~/.codex/rules/default.rules`, so future one-off approvals stay local.

If `codex/rules/default.rules` becomes dirty because Codex stored one-off
approvals there, run:

```bash
./install.sh repair-codex-rules
```

The repair command moves those approvals into `rules/default.rules` and links them
alongside the portable baseline.

The two defaults files are parsed and merged by key only at initialization, so
local values replace portable defaults without duplicate keys. Afterward, edit
`~/.codex/config.toml` directly. Deleting a preference keeps it omitted; new
upstream defaults do not reappear, and ordinary updates preserve the entire file.
Invalid installed TOML is left unchanged and reported as an error. Bundle installs
continue independent components and return nonzero if any component failed.

`shell_environment_policy` is a recommended initial value, not an enforced
requirement. `install.sh status` reports differences from the portable recommendation
for manual review; neither requirements nor status silently applies that policy.

Goldband's Codex status line is applied only by `./install.sh codex-statusline`.
It changes only `tui.status_line`, including in an otherwise empty config, but this
explicit action can reformat TOML and remove comments. Both hosts retain `.bak`
and `.bak.previous` before changing personal settings, with no rotation on a no-op.
Older backups are left in place. Uninstall preserves the shared Codex config and
personal rules, including the local `default.rules` approval overlay.
