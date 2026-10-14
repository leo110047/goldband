# Goldband Failure Taxonomy

This taxonomy is the living ledger for telemetry-derived failure mining. The
miner groups candidates from existing `goldband.telemetry.v1` usage events and
Goldband Loop workflow evidence. It does not create new telemetry schema fields.

All automated classifications produced by `scripts/mine-telemetry.mjs classify`
are `confidence: "inferred"` and `needs_human_label: true`. Human review is
required before treating a candidate as a confirmed product or policy failure.

## Case Output Contract

Each classification includes:

- `category`: one taxonomy category from this document.
- `source_event_id`: stable anonymized id derived from the source event.
- `evidence_fields`: original field paths used by the miner.
- `confidence`: `confirmed` or `inferred`; miner heuristics use `inferred`.
- `needs_human_label`: `true` until a human confirms the label.
- `sanitized_example`: source fields after secret scan, path rewrite, id
  anonymization, and content truncation.

## false-positive-deny

Definition: a deny candidate that may have blocked a safe operation.

Judgment basis:

- Source event has `category: "hook-decision"` and `action: "deny"`.
- Evidence fields include `name`, `detail.hookEventName`, `detail.toolName`,
  and `recordedAt`.
- The miner may mark this when a later non-blocking signal appears in the same
  run and near time window. That is only a triage hint, not proof.

Recommended action: human-label the original context. If confirmed false
positive volume clusters on one rule, adjust that rule and add replay coverage.

Telemetry alone cannot decide a false positive: deny events do not persist the
tool payload.

## true-deny

Definition: a deny candidate that appears aligned with an existing safety rule.

Judgment basis:

- Source event has `category: "hook-decision"` and `action: "deny"`.
- Evidence fields include `name`, `detail.hookEventName`, `detail.toolName`,
  and `recordedAt`.
- The miner uses this as the default bucket when no nearby false-positive hint
  exists.

Recommended action: keep or add replay coverage for repeated rules. Human review
is still required before calling it a confirmed correct deny.

## workflow-drift

Definition: workflow runtime evidence stopped outside the declared happy path.

Judgment basis:

- Source row comes from
  `${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl` or an
  explicit `--workflow-runs-dir`.
- Evidence fields include `workflow`, `step`, `status`, `error`, and
  `startedAt`.
- Current automatic classification covers `status: "failed"` and
  `status: "skipped"`.

Recommended action: inspect whether the workflow needs a typed runtime step,
clearer stop condition, or better blocked-state reporting.

## cross-review-rejection

Definition: cross-review asked for changes, escalated, or blocked completion.

Judgment basis:

- Source event name starts with `cross-review-`.
- Rejection evidence includes `detail.verdict: "CHANGES_REQUESTED"`,
  `detail.verdict: "ESCALATE"`, `name: "cross-review-escalation"`, or
  `action: "block"`.
- Evidence fields include `name`, `action`, `detail.verdict`,
  `detail.blockingCount`, and `detail.summaryPath` when present.

Recommended action: review the rejection reason and implementer response. If
rejections repeat for the same workflow, tighten the plan/rebuttal contract.

## mode-enforcement-block

Definition: careful or freeze mode blocked a requested operation.

Judgment basis:

- Source event has `category: "mode-enforcement"` and `action: "block"`.
- Evidence fields include `name`, `detail.rule`, `detail.toolName`, and
  `detail.commandPreview`.

Recommended action: check whether the mode block prevented a real risky action
or overreached. Repeated overreach should become a mode-rule tuning candidate.

## needs-instrumentation

Report status for a category that current fields cannot support. Confirmed
`false-positive-deny` and `true-deny` labels are in this status: persisted deny
events omit the tool payload, so they require human judgment.
