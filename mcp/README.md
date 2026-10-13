# MCP Templates

These templates provide dual-host MCP starting points without enabling any
server by default.

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

Goldband no longer ships its own browser. For `qa/app` and other browser work,
use the host's browser tool: Claude in Chrome, Codex's built-in browser, or the
`playwright` entry in the templates. The template pins `@playwright/mcp@0.0.83`
and adds four defaults:

- `--isolated` keeps the browser profile in memory, so the agent never reuses
  your real sign-ins and nothing persists between sessions.
- `--allowed-origins=http://localhost:*;http://127.0.0.1:*` limits navigation to
  local development servers. Add your staging origin (for example
  `;https://staging.example.com`) when you need it. Playwright documents this
  option as not a security boundary (it does not cover redirects), so treat it
  as protection against accidental browsing, not enforcement.
- `--output-dir=/path/to/goldband-home/playwright-mcp` keeps page snapshots
  and console logs out of the project. Without it, Playwright MCP writes a
  `.playwright-mcp/` directory into whatever directory the agent runs in.
  Replace the placeholder with an absolute path: the option does not expand
  `~`, and a `~/...` value creates a literal `~` directory in the project.
- `--output-max-size=5242880` sets a 5 MB eviction threshold, not a hard cap.
  After each tool response, Playwright MCP deletes the oldest earlier output
  files until the directory is back under 5 MB; files written by that response
  are never deleted, so one oversized response can leave the directory above
  the threshold, and a failed delete is only logged at debug level. Earlier
  files from the same session can be evicted too. This bounds growth but does
  not erase recent output: snapshots hold page text in plain form, so after
  testing a system with real or sensitive data, delete
  `$GOLDBAND_HOME/playwright-mcp` (default `~/.goldband/playwright-mcp`).

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
npm through `npx`. An entry installed before the output-dir or size-cap
defaults keeps its old arguments; remove it (`claude mcp remove playwright -s user`, and the
`[mcp_servers.playwright]` table) and rerun the installer to pick it up.

To add it by hand instead:

```bash
claude mcp add --scope user playwright -- npx -y @playwright/mcp@0.0.83 --isolated \
  "--allowed-origins=http://localhost:*;http://127.0.0.1:*" \
  "--output-dir=$HOME/.goldband/playwright-mcp" --output-max-size=5242880
```

## Token-Backed Setup Flow

Token-backed servers are still opt-in. Do not commit credentials.

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

First validate local syntax:

```bash
python3 -m json.tool mcp/claude.mcp.json.template
python3 scripts/check-json-toml-syntax.py
```

For any server a user actually enables, run an MCP Inspector smoke test before
documenting it as supported:

```bash
npx @modelcontextprotocol/inspector <server-command>
```

The smoke test must verify that the server starts and exposes the expected tool
list. Token-backed servers such as GitHub or Sentry require user-provided
credentials and must not be enabled by default.
