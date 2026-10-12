# Goldband Telemetry Schema v1

Goldband telemetry is local JSONL first. OTLP traces are a derived export view.
Hooks never send telemetry over the network.

Schema artifacts:

- Code normalizer and validator: `scripts/lib/telemetry-schema.cjs`
- JSON Schema: `schemas/telemetry.v1.schema.json`
- Summary reader: `hooks/scripts/lib/hook-router/usage-summary.js`
- OTLP exporter: `scripts/export-telemetry-otlp.mjs`

## Event Contract

Every new usage event is normalized before append:

| Field | Required | Description |
| --- | --- | --- |
| `schema_version` | yes | Always `goldband.telemetry.v1`. |
| `run_id` | yes | Cross-host run/session correlation key. |
| `event_id` | yes | Unique event identifier. Used as OTLP span ID source. |
| `parent_event_id` | no | Parent event link. Used as OTLP parent span ID source. |
| `sessionId` | compatibility | Legacy field retained for existing summary tools. |
| `category` | yes | Event family, such as `workflow-entry` or `hook-decision`. |
| `name` | yes | Workflow, hook rule, advisory, mode, or trigger name. |
| `action` | yes | Event action, such as `invoked`, `deny`, or `matched`. |
| `source` | yes | Adapter/script that produced the event. |
| `host` | yes | `claude`, `codex`, or `unknown`. |
| `confidence` | no | `confirmed` or `inferred` for workflow signals. |
| `detail` | yes | Event-specific structured data. |
| `recordedAt` | yes | ISO-8601 timestamp written by the append layer. |

Current v1 categories:

- `workflow-entry`
- `hook-decision`
- `hook-advisory`
- `prompt-trigger`
- `mode`
- `mode-enforcement`
- `test`

Current v1 actions:

- `invoked`
- `requested`
- `deny`
- `emit`
- `record`
- `matched`
- `suggested`
- `enable`
- `disable`
- `block`

## Existing Field Differences

Claude workflow telemetry currently writes:

- `sessionId` from `input.session_id`, `input.sessionId`,
  `CLAUDE_SESSION_ID`, or `CODEX_SESSION_ID`.
- `source` as the Claude hook script path, such as
  `hooks/scripts/hooks/hook-router.js`.
- `host` as `claude`.
- `detail.trigger`, `detail.hookEventName`, and `detail.toolName` for workflow
  entries.

Codex telemetry currently writes:

- `sessionId` from `input.session_id`, `input.sessionId`, or
  `CODEX_SESSION_ID`.
- `source` as `codex/hooks/hook-router.js`.
- `host` as `codex`.
- `detail.host`, `detail.hookEventName`, `detail.toolName`, and
  `detail.startSource` for hook outcomes.

`prompt-trigger` remains a valid category so older JSONL files still validate;
current hooks no longer emit keyword skill suggestions. Mode toggles write
`mode` events from `hooks/scripts/lib/hook-router/mode-cli.js`.

## Run ID Rules

`run_id` is resolved in this order:

1. Existing `run_id` / `runId`.
2. Host input `session_id` / `sessionId`.
3. Host env session ID: `CLAUDE_SESSION_ID` or `CODEX_SESSION_ID`.
4. Explicit `GOLDBAND_RUN_ID`.
5. Persistent marker file from `GOLDBAND_RUN_ID_FILE`.
6. Transcript path hash when the hook input includes `transcript_path` or
   `agent_transcript_path`.
7. `unknown`.

`GOLDBAND_RUN_ID_FILE` is the per-session marker fallback: when a caller points
it at a session-scoped file, Goldband reads the existing UUID or creates one.
The implementation does not generate a per-process UUID. When the host does not
provide a stable session marker and no marker file is configured, `unknown` is
safer than splitting one run into many process-local traces.

## Legacy Compatibility

Readers tolerate old JSONL without `schema_version`, `run_id`, or `event_id`.
The exporter normalizes legacy rows in memory:

- Legacy `sessionId` / `session_id` becomes `run_id`.
- Missing run/session data becomes `run_id: "unknown"`.
- Missing `event_id` is normalized to a deterministic content hash during
  export so re-exporting the same legacy row keeps the same span ID.

`usage-summary.js` groups unique sessions by `run_id`, `runId`, `sessionId`, or
`session_id`, in that order. Rows with `run_id: "unknown"` intentionally share
one fallback bucket because no durable run marker exists.

## OTLP Mapping

Exported traces use one trace per `run_id`; each JSONL event becomes one span.

| JSONL field | OTLP mapping |
| --- | --- |
| `run_id` | `traceId` source and `gen_ai.conversation.id` |
| `event_id` | `spanId` source |
| `parent_event_id` | `parentSpanId` source |
| `category:name` | span `name` |
| `workflow-entry` | `gen_ai.operation.name=invoke_workflow` |
| `hook-decision` / `hook-advisory` | `gen_ai.operation.name=execute_tool` |
| `host=claude` | `gen_ai.provider.name=anthropic` |
| `host=codex` | `gen_ai.provider.name=openai` |

The GenAI semantic conventions checked on 2026-07-05 are marked Development,
so Goldband keeps its own `goldband.*` attributes alongside `gen_ai.*`
attributes.
