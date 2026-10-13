# Shared Review Rubric

Canonical judgment standard for `/review` and `cross-review`. Their runtimes
own execution, permissions, output, aggregation, and gates.

## Taxonomy

- `correctness-contract`: feature correctness, state transitions, explicit
  requirements, schemas, permissions, error handling, and data consistency.
- `testing`: missing or weak regression tests, fixtures, old-behavior failure
  proof, and test claims that do not cover the stated risk.
- `security`: auth/authz, secret handling, injection, unsafe IO, supply chain,
  sandboxing, and trust-boundary enforcement.
- `performance`: N+1 behavior, hot paths, query or bundle growth, memory
  pressure, and clear scaling risks.
- `migration-data`: schema changes, migrations, backfills, backwards
  compatibility, rollback, and rollout safety.
- `api-host-parity`: CLI/API contracts, Claude/Codex host parity, installers,
  workflow routing, prompts, hooks, and runtime consistency.
- `maintainability`: duplicated logic, abstraction fit, ownership boundaries,
  naming, and long-term maintenance risk.
- `ux-design`: user-facing layout, accessibility, interaction, copy, and visual
  regressions when the diff touches UI.

## Performance Claims

- Check that before/after measurements exercise the changed path at relevant
  scale, with comparable environments, cold/warm state, and timing variation.
  Elapsed time does not prove CPU or memory savings.
- Distinguish evaluator-only shortcuts from contract-preserving input
  specialization or caching; repeated cached inputs only support that workload.
- Missing measurements are an evidence gap, not proof of regression. Block only
  for a concrete defect or unmet explicit acceptance requirement; unrelated
  edits need no benchmark.

## Severity

Use the lowest severity supported by concrete evidence.

- `critical`: explicit contract, approval, safety, data, authorization,
  sandbox, command, paid action, or external side-effect boundary can be
  violated with no safe workaround.
- `high`: a documented or normal workflow fails, a required verification or
  parity claim is false, or a contained security/safety boundary weakens.
- `medium`: real issue that should be fixed, but no normal workflow or protected
  boundary is broken.
- `low`: minor maintainability, naming, docs, or performance follow-up.
- `info`: skipped/degraded coverage, useful context, or an unverified issue that
  is not supported enough to stay high severity.

Without concrete evidence, downgrade high/critical findings to `info`.
Insufficient evidence requiring human judgment is `info` in `/review` and
`ESCALATE` in `cross-review`.

## Finding validity

Every finding needs an exact source location, concrete evidence, and practical
impact. Apply the standard for the claim:

- Product defect: a reachable input or state, incorrect result, and expected
  behavior.
- Verification gap: an explicit requirement or concrete risk, missing or
  ineffective evidence, and the check needed. In `failureScenario`, describe
  the contract violation that could escape detection; do not claim it occurred.
  Prior proof of a product defect is not required.

Category, policy, recommendation, and verification metadata do not validate
unsupported findings. Suppress speculation; do not display confidence scores.

## Finding kinds

Set `kind`. `defect` meets the standard above. `improvement` is an adoptable
design change with no reachable failure: split ownership, leaked complexity,
wrong layer, needless abstraction, or coupling blocking behavior tests. Cite
code in `evidence`; give the smallest change and benefit in `recommendation`;
use `medium`, `low`, or `info`; must be fixed. Without session evidence, do not blame the author's process.

In `/review`, `blocking` means "must fix before landing", not session signing or
blocking. `cross-review` applies its own verdict rules.
