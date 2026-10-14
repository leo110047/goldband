# MCP Templates

Dual-host MCP templates. No server is enabled by default.

## Files

- `server/`: first-party zero-token `goldband-mcp` stdio server.
- `first-party-servers.json`: first-party MCP inventory.
- `claude.mcp.json.template`: Claude-style `.mcp.json` template.
- `codex.config.toml.template`: Codex `config.toml` MCP table template.
- `token-backed-servers.json`: token-backed MCP inventory used by status
  checks.
- `../codex/local/mcp.env.example`: ignored local env template for token
  presence checks.

## First-Party Goldband Server

`goldband-mcp` exposes four read-only tools:

- `goldband_policy_check`: dry-runs Claude `PreToolUse` policy through the
  existing hook-router `evaluatePreToolUse` module. It does not execute shell
  commands and does not include Codex-only high-risk policy.
- `goldband_telemetry_query`: reads hook-router usage telemetry and aggregates
  counts by rule or skill through the shared usage summary module.
- `knowledge-query`: reads
  `${GOLDBAND_HOME:-$HOME/.goldband}/knowledge/index.json` and returns matching
  knowledge entry paths plus one-line summaries.
- `goldband_health_check`: runs only the fixed repo-validation allowlist:
  JSON/TOML syntax, hook script references, Goldband Loop inventory, and
  decision guidance parity.

Build and test it from a full checkout:

```bash
npm ci --prefix mcp/server
npm run test:mcp-server
npm run smoke:mcp-server
```

The installer does not enable this server by default. To opt in, build the
server, copy the `goldband` entry from the relevant template into your host MCP
config, replace `/path/to/goldband` with this checkout path, and set the entry
to enabled.

## Playwright MCP for Browser QA

Goldband ships no browser. `qa/app` and other browser work use the host's
browser tool or the `playwright` entry in the templates. The template pins `@playwright/mcp@0.0.83`
and adds four defaults:

- `--isolated` keeps the browser profile in memory, so the agent never reuses
  your real sign-ins and nothing persists between sessions.
- `--allowed-origins=http://localhost:*;http://127.0.0.1:*` limits navigation to
  local development servers; further origins are appended with `;`. It does not
  cover redirects and is not a security boundary.
- `--output-dir=/path/to/goldband-home/playwright-mcp` keeps page snapshots
  and console logs out of the project; without it, Playwright MCP writes
  `.playwright-mcp/` into the agent's working directory. The value must be an
  absolute path; `~` is not expanded.
- `--output-max-size=5242880` sets a 5 MB eviction threshold, not a hard cap:
  after each tool response, the oldest earlier output files are deleted until
  the directory is under 5 MB, never files from that response. Snapshots hold
  page text in plain form; delete `$GOLDBAND_HOME/playwright-mcp` (default
  `~/.goldband/playwright-mcp`) after testing with sensitive data.

Page content returned by Playwright MCP is not wrapped or scanned for prompt
injection. The protection against injected instructions is what the agent may
do afterwards: native permissions, auto-mode review, sandboxing, and the
approval rules in `goldband-loop/manuals/browser.md`. For unfamiliar external
sites, prefer Claude in Chrome, which has its own prompt-injection safeguards.

`./install.sh all-with-workflow` adds this entry to both hosts: Claude Code
through `claude mcp add --scope user`, and Codex by appending an
`[mcp_servers.playwright]` table to `~/.codex/config.toml` (a backup is kept).
The installer reads the command from `claude.mcp.json.template`, replaces the
output-dir placeholder with `$GOLDBAND_HOME` (default `~/.goldband`) as an
absolute path, leaves any existing `playwright` entry untouched, and wraps
`npx` in `cmd /c` on Windows.
Set `GOLDBAND_SKIP_PLAYWRIGHT_MCP=1` to skip it; `./install.sh status` reports
whether each host has it. Other install targets and `auto-refresh` never add
it, so a removed entry stays removed. The first use downloads the package from
npm through `npx`. The installer never updates an existing entry; to apply the
current defaults, remove it (`claude mcp remove playwright -s user` and the
`[mcp_servers.playwright]` table) and rerun the installer.

A manual entry uses the same command and arguments as the `playwright` entry
in `claude.mcp.json.template`, with the output-dir placeholder replaced by an
absolute path.

## Token-Backed Setup Flow

Token-backed servers are opt-in. Credentials are never committed.

1. Copy `codex/local/mcp.env.example` to `codex/local/mcp.env`.
2. Fill only the local env file, or export the same variables in the shell that
   launches Codex/Claude.
3. Copy the selected MCP table from `mcp/codex.config.toml.template` or
   `mcp/claude.mcp.json.template` into the host config and set that server to
   enabled.
4. Check token presence without printing secrets:

```bash
node scripts/check-mcp-token-status.mjs --mcp-env-file codex/local/mcp.env --print-smoke
```

5. Run the printed MCP Inspector command before documenting the server as
   supported.

## Validation

`scripts/check-json-toml-syntax.py` checks template syntax. A server is
documented as supported only after an MCP Inspector smoke test shows that it
starts and exposes the expected tool list. Token-backed servers require
user-provided credentials and are never enabled by default.
