# Observability

Goldband observability has two layers:

1. Local JSONL telemetry under the persistent Goldband data root.
2. Optional OTLP trace export from JSONL with `scripts/export-telemetry-otlp.mjs`.
3. Offline mining from JSONL with `scripts/mine-telemetry.mjs`.

Nothing is uploaded by default. Export is a manual or scheduled opt-in action.

## Start a Local Trace UI

Jaeger all-in-one is the shortest local demo path because it accepts OTLP/HTTP
on `4318` and serves a UI on `16686`.

```bash
docker run --rm --name goldband-jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:1.57
```

Open:

```text
http://localhost:16686
```

## Trigger a Hook Event

Use a temp usage file so the demo does not mix with your normal local
telemetry:

```bash
TMP_DIR=$(mktemp -d)
printf '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"notes/random-notes.md","content":"ghp_%036d"}}\n' 0 \
  | GOLDBAND_USAGE_FILE="$TMP_DIR/usage-events.jsonl" \
    CLAUDE_SESSION_ID="demo-run" \
    node hooks/scripts/hooks/hook-router.js >/tmp/goldband-demo-hook.out
```

That fixture should be denied by `secret-detector` and written to the JSONL
usage file.

## Export to OTLP

Dry-run first:

```bash
node scripts/export-telemetry-otlp.mjs \
  --usage-file "$TMP_DIR/usage-events.jsonl" \
  --dry-run
```

Send to Jaeger:

```bash
node scripts/export-telemetry-otlp.mjs \
  --usage-file "$TMP_DIR/usage-events.jsonl" \
  --endpoint http://127.0.0.1:4318
```

In Jaeger, select service `goldband` and click **Find Traces**. The demo trace
should show a span named similar to:

```text
hook-decision:secret-detector
```

The span attributes include `goldband.run_id=demo-run`,
`goldband.category=hook-decision`, `gen_ai.operation.name=execute_tool`, and
`gen_ai.provider.name=anthropic`.

## Exporter Options

```bash
node scripts/export-telemetry-otlp.mjs --help
```

Supported flags:

- `--endpoint <url>`: OTLP/HTTP endpoint. Defaults to `http://localhost:4318`.
  The exporter appends `/v1/traces` when needed.
- `--usage-file <path>`: JSONL usage file. Defaults to the normal Goldband
  usage file.
- `--cursor-file <path>`: cursor file. Defaults to
  `<usage-file>.otlp-cursor.json`.
- `--since <iso-date>`: filter events at or after the timestamp for `--dry-run`
  inspection only. Formal exports reject `--since` so a cursor cannot skip older
  unsent events.
- `--dry-run`: print the OTLP JSON payload and do not send or advance cursor.
- `--limit <n>`: export at most `n` events.

## Privacy Boundary

Goldband does not run an exporter daemon and does not send telemetry from hooks.
The only network step is explicitly running `scripts/export-telemetry-otlp.mjs`
without `--dry-run`.

## Mine Local Telemetry

The telemetry miner is a read-only consumer for failure taxonomy, replay fixture
candidates, telemetry-derived eval candidates, and curated knowledge candidates:

```bash
node scripts/mine-telemetry.mjs summary --days 7
node scripts/mine-telemetry.mjs classify --days 7
node scripts/mine-telemetry.mjs extract-fixtures --days 7 --out-dir /tmp/goldband-telemetry-review
node scripts/mine-telemetry.mjs extract-evals --days 7 --out-dir /tmp/goldband-telemetry-review
node scripts/mine-telemetry.mjs extract-knowledge --days 7
```

`summary` prints markdown by default and supports `--json`. `classify` emits
machine-readable taxonomy candidates. `extract-fixtures` and `extract-evals`
write sanitized review candidates to the output directory; they do not modify
the replay fixture file or run paid evals. Fixture extraction does execute hook
replay verification, but does so with Goldband state and data roots redirected
to a temp sandbox. `extract-knowledge` writes `status: candidate` markdown
entries under `<out-dir>/knowledge-candidates/knowledge/` by default so humans
can review them before promotion. Passing `--knowledge-home <path>` explicitly
writes under `<path>/knowledge/` and updates that local `index.json`. It still
treats telemetry and workflow evidence JSONL as read-only inputs.

Candidate outputs reuse `hooks/scripts/lib/hook-router/secret-patterns.js`,
rewrite local absolute paths, anonymize run/event ids, and truncate content-like
fields. See [failure taxonomy](failure-taxonomy.md) for category meanings and
human-label requirements.

Telemetry-derived knowledge stays below the trust boundary until reviewed:

- ids are deterministic `telemetry-miner-YYYYMMDD-hash8` values from source
  pointer plus sanitized summary, so duplicate mining does not create or
  overwrite extra entries;
- `trust_level` is `telemetry-derived`, `reviewed_by` is empty, and
  `staleness` is `needs-review`;
- default `goldband-knowledge search` and MCP `knowledge-query` recall only
  `active` entries, so telemetry candidates appear only through explicit
  candidate review or `--status candidate`.
