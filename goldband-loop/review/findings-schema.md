# Shared Finding Shape

Independent `review/code` output use this shape:

```json
{
  "file": "path/to/file.ts",
  "line": 42,
  "severity": "critical|high|medium|low|info",
  "category": "correctness-contract|testing|security|performance|migration-data|api-host-parity|maintainability|ux-design|specialist-runtime|specialist-skipped|host-capability",
  "ruleId": "architecture-boundaries",
  "policySource": "rules/architecture-boundaries.md",
  "summary": "One-sentence problem.",
  "failureScenario": "Concrete way this fails for a user, maintainer, workflow, or gate.",
  "evidence": "Specific diff/code/test/config evidence.",
  "recommendation": "What should change. Text only; no fixes are applied.",
  "suggestedVerification": "Command, test, readback, or manual check that proves the fix.",
  "blocking": true,
  "specialist": "testing",
  "contributingSpecialists": ["testing", "correctness-contract"]
}
```

Validity rules:

- Use `null` for optional fields that do not apply when a JSON schema requires
  the key.
- Code findings require an exact `file` and `line`, concrete `evidence`, and a
  `failureScenario` that identifies the triggering input or runtime state,
  reachable path, incorrect result, expected result, and practical impact.
- `recommendation`, `suggestedVerification`, policy, and specialist fields are
  metadata. They cannot substitute for the validity requirements above.
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
