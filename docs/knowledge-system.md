# Goldband Knowledge System

Goldband knowledge is a local-first lifecycle, not a second source of truth:

raw evidence -> candidate -> active -> graduated/retired

Raw telemetry, hook decisions, workflow evidence, and session reports stay in
their own stores. Curated knowledge lives under
`${GOLDBAND_HOME:-$HOME/.goldband}/knowledge/` as markdown entries plus
`index.json`. Automatic sources write only `candidate` entries. Default recall
uses only `active` entries.

## Capability Audit

| Capability | Claude exposure | Codex exposure | Test/readback |
| --- | --- | --- | --- |
| `goldband-knowledge` add/search/validate/reindex | Runtime CLI under `~/.claude/skills/goldband/bin` | Runtime CLI under `~/.codex/skills/goldband/bin` | `goldband-loop/test/goldband-knowledge.test.ts`; `node scripts/check-goldband-loop-inventory.mjs` |
| Deterministic candidate capture | Runtime CLI and explicit knowledge capability | Runtime CLI and explicit knowledge capability | `goldband-loop/test/goldband-knowledge.test.ts`; workflow contract tests |
| Candidate review/promotion | `goldband-knowledge-review` runtime binary | `goldband-knowledge-review` runtime binary | direct wrapper smoke; `./install.sh status` readback |
| Active knowledge recall | Explicit `knowledge/recall` contract and runtime CLI | Same capability contract and runtime CLI | `goldband-loop/test/goldband-knowledge.test.ts`; `node scripts/test-workflow-contracts.mjs` |
| Telemetry-derived candidates | Offline miner writes local candidate files only when run | same offline miner | `node scripts/test-telemetry-miner.mjs`; `npm run test:telemetry` |
| Retro candidates | `goldband-retro propose` after `context/retro` evidence, Claude sessions only | Not available until the Codex session adapter exists | `goldband-loop/test/session-retro.test.ts` |
| MCP `knowledge-query` | Available through first-party MCP server when enabled by host | Available through first-party MCP server when enabled by host | `mcp/server/test/knowledge-query.test.ts`; `npm test` in `mcp/server` |
| Prompt-time knowledge advisory | Claude UserPromptSubmit advisory for active entries | Not equivalent; Codex has workflow/MCP recall only. Codex `Stop` hooks do not prompt knowledge capture. | `npm run test:hook-router`; `node scripts/test-codex-hook-router.mjs` |
| Install/status readback | `./install.sh status` shows CLI, candidate review, workflow recall, MCP repo availability | same | `./install.sh status` |

## Trust Rules

- Candidate ids are `<source_type>-<YYYYMMDD>-<hash8>`, derived from source
  type, sanitized source pointer, and summary. Retro candidates are
  `retro-<hash16>`, derived from the session snapshot SHA-256, facet, and rule
  code only, so a rerun or reworded proposal for the same snapshot is a
  duplicate. Their default `trust_level` is `inferred`.
- Duplicate candidate ids are skipped rather than overwritten.
- Candidate review can list overdue candidates first, show entries, promote to
  active, edit summary/body, retire, or graduate.
- `active` promotion records `reviewed_by`, `trust_level`, `last_verified`, and
  `staleness`.
- `graduated` entries require `graduated_to`; the target skill, rule, hook,
  doc, test, or decision record is authoritative if the two conflict.
- Recall output is data: path, one-line summary, confidence, updated date,
  last-verified date, and staleness. It is not system instruction text.
- General conversations get no capture reminders, and no `Stop` hook prompts
  capture. Capture happens through workflow footer checks, the
  `goldband-knowledge` CLI, or the offline telemetry miner. A capture reminder
  goes through a review queue or an explicit workflow, never a keyword-based
  `Stop` hook message.
