# Change Scope: Right-Sizing Fixes

## Baseline Policy

Choose the smallest sufficient solution that fully addresses the current
requirement, root-cause class, authoritative ownership, and required safety
boundaries. This is not the smallest diff: symptom patches, special cases,
fallbacks, duplicated authority, and weakened safeguards remain invalid. If
the cause or boundary cannot be named, investigate before editing.

## Pre-Implementation Proportionality

Before selecting a direction or editing, apply this check when a proposal adds
or expands a permanent approval, permission, state, gate, artifact, lineage,
coordination workflow, external side effect, or generic mechanism:

- Name the current requirement, root-cause class, or safety boundary it serves.
- Name the smallest sufficient alternative.
- If the smaller option is insufficient, name the requirement, reachable risk,
  or boundary invariant it leaves uncovered.
- Identify whether the proposal changes normal work unrelated to the triggering
  event.
- Identify whether permanent operational or maintenance cost is being added for
  a one-time or low-frequency problem.
- Verify that it does not create a second authority, state owner, or decision
  path.
- Before choosing the heavier option, cite current evidence showing why the
  smaller option is insufficient.

Current evidence may be an explicit product, security, permission, or compliance
requirement; a reachable or reproducible failure path; a native-authority, data
integrity, or external-side-effect invariant; or a measured scale, frequency, or
concurrency constraint. Hypothetical future use, abstract completeness, and
enterprise-readiness without a reachable failure path are not sufficient.

Do not remove or narrow a necessary native approval, authorization,
destructive-action guard, data-safety rule, or external-side-effect boundary in
the name of simplicity. Keep each required safeguard at the narrowest scope that
covers current evidence.

Phase metadata expresses applicability, not deterministic enforcement. Planning
and implementation guidance are judgment defaults; review remains the existing
enforcement and backstop.

## Required Behavior

- Fix at the layer where the cause lives, not the layer where the symptom is
  easiest to suppress.
- Before writing a new helper, abstraction, or config flag, search for an
  existing one. Preference order: reuse, then deletion, then addition.
- Before adding a branch, constant, fallback, or special case, decide whether
  the requirement is one isolated instance or a recurring class. Name the
  authoritative owner, the expected change it must survive, and whether the
  proposal would create a second source of truth.
- A failure class is every location with the same root cause or violated
  contract; a review finding reports one instance of it. Fix every instance of
  the class within the change scope, and report instances outside it.
- Do not introduce an abstraction, option, or indirection only for hypothetical
  future users. A single current call site is justified when it creates a real
  ownership boundary, external adapter, test seam, or stable domain concept;
  name that reason in the change.
- A failing gate is evidence of a contract disagreement, not permission to
  bypass it. Verify whether the implementation or the gate is wrong. Change a
  gate only when evidence shows its stated policy is wrong or outdated, and
  update the policy text and regression coverage in the same change.
- Do not reformat, rename, or refactor code outside the task in the same
  change. Note the opportunity for the user instead of taking it.
- Delete dead code instead of commenting it out or retaining it.
- When the smallest sufficient solution and a heavier structural option diverge,
  prefer the smaller option unless current evidence identifies what it cannot
  cover. Present both with their permanent costs when the evidence leaves a
  material tradeoff for the user.

## Failure Signals

- The diff keeps growing while the intended behavior change stays the same.
- "While I'm here" edits appear in the change.
- The fix is clever but you cannot explain it plainly.
- New configuration or flags exist that no requirement asked for.
- A new branch or fallback handles one observed example but not the class of
  failures it represents.
- Two layers can now compute or decide the same domain fact independently.
