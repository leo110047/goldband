# Shared Finding Shape

Independent `review/code` output use this shape:

```json
{
  "kind": "defect|improvement",
  "file": "path/to/file.ts",
  "line": 42,
  "severity": "critical|high|medium|low|info",
  "category": "correctness-contract|testing|security|performance|migration-data|api-host-parity|maintainability|ux-design|host-capability",
  "ruleId": "architecture-boundaries",
  "policySource": "rules/architecture-boundaries.md",
  "summary": "One-sentence problem.",
  "failureScenario": "Concrete way this fails for a user, maintainer, workflow, or gate.",
  "evidence": "Specific diff/code/test/config evidence.",
  "recommendation": "What should change. Text only; no fixes are applied.",
  "suggestedVerification": "Command, test, readback, or manual check that proves the fix.",
  "blocking": true
}
```

Validity rules:

- Use `null` for optional fields that do not apply when a JSON schema requires
  the key.
- A `defect` requires an exact `file` and `line`, concrete `evidence`, a
  `failureScenario`, and `suggestedVerification` or `reproductionStep`.
  Apply `shared-rubric.md` to distinguish product defects from verification gaps;
  an undetected contract violation is not an observed product failure.
- An `improvement` requires non-empty `evidence` and `recommendation` (no
  `failureScenario` needed) and severity `medium`, `low`, or `info`. The runtime forces
  `blocking` to `true`, keeps every valid one after deduplication, and lists
  invalid improvements with the discard reason. It never reclassifies kind or severity.
- Defects and valid improvements both count toward the review signal.
- `recommendation`, `suggestedVerification`, and policy fields are metadata for
  defects. They cannot substitute for the validity requirements above.
- Human-readable reports must preserve `evidence` and
  `suggestedVerification` when those fields are present in the validated
  finding.
- Suppress speculative findings instead of returning a confidence score.
- Findings are semantic observations. They never authorize completion or mutate tickets.
- Suggested verification is not an executed result; project checks run separately.
- Do not output patches or apply fixes.
- Do not output cross-review verdict markers from `review/code`.
- When a finding enforces a Goldband Rule, preserve its `ruleId` and
  `policySource` through normalization and aggregation. Use `null` only when no
  Rule applies.
