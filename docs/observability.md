# Observability

Goldband observability has three layers over one source of truth:

1. Local JSONL telemetry under the persistent Goldband data root.
2. Optional OTLP trace export with `scripts/export-telemetry-otlp.mjs`.
3. Offline mining with `scripts/mine-telemetry.mjs`.

## Privacy Boundary

Hooks never send telemetry, and no exporter daemon runs. The only network step
is running `scripts/export-telemetry-otlp.mjs` without `--dry-run`.

## OTLP Export

The exporter reads the usage JSONL and sends a derived OTLP/HTTP traces payload.
Each usage event becomes a span named `<category>:<name>` under service
`goldband`, carrying `goldband.*` and `gen_ai.*` attributes. Events sharing a
`run_id` share a trace; `parent_event_id` becomes the parent span.

- `--endpoint <url>`: OTLP/HTTP endpoint, default `http://localhost:4318`;
  `/v1/traces` is appended when absent.
- `--usage-file <path>`: usage JSONL, default the normal Goldband usage file.
- `--cursor-file <path>`: export cursor, default
  `<usage-file>.otlp-cursor.json`.
- `--since <iso-date>`: event filter, accepted only with `--dry-run` so a cursor
  never skips unsent events.
- `--dry-run`: print the payload without sending or advancing the cursor.
- `--limit <n>`: export at most `n` events.

## Telemetry Mining

`node scripts/mine-telemetry.mjs <command>` reads telemetry and workflow
evidence without modifying them. `--help` lists options.

- `summary`: markdown report, or JSON with `--json`.
- `classify`: taxonomy candidates; categories and labeling rules are in
  [failure taxonomy](failure-taxonomy.md).
- `extract-fixtures` and `extract-evals`: sanitized review candidates written to
  `--out-dir`. Fixture extraction runs hook replay with Goldband state and data
  roots redirected to a temp sandbox; it never edits the replay fixture file or
  runs paid evals.
- `extract-knowledge`: `status: candidate` entries under
  `<out-dir>/knowledge-candidates/knowledge/`, or under `<path>/knowledge/` with
  its `index.json` updated when `--knowledge-home <path>` is given.

Candidates pass through `hooks/scripts/lib/hook-router/secret-patterns.js`, with
local absolute paths rewritten, run and event ids anonymized, and content-like
fields truncated.

Telemetry-derived knowledge stays below the trust boundary until reviewed:

- ids are deterministic `telemetry-miner-YYYYMMDD-hash8` values from the source
  pointer and sanitized summary, so repeated mining neither duplicates nor
  overwrites entries;
- `trust_level` is `telemetry-derived`, `reviewed_by` is empty, and `staleness`
  is `needs-review`;
- default `goldband-knowledge search` and MCP `knowledge-query` recall only
  `active` entries, so candidates appear only through candidate review or
  `--status candidate`.
