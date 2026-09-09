---
name: decision-log
description: Record a decision with lasting architectural or process consequences using the repository's existing ADR convention. Skip routine implementation choices.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Edit
---

# Decision Log

Record an actual decision, its rationale, and the consequences future work needs
to understand. Follow the repository's existing decision location and format.
Create a new record only when the user or repository requires it.

- Keep proposed decisions distinct from accepted decisions.
- Include the context, chosen option, important alternatives and tradeoffs,
  assumptions, and evidence behind the choice.
- Name failure signals and revisit triggers when the decision depends on
  assumptions that may change.
- Supersede an obsolete decision rather than rewriting its history.
- Do not duplicate implementation details or Git history as an ADR.

Use [adr-template.md](reference/adr-template.md) only when a template is needed
and the repository does not already provide one. Read back the saved record
before reporting its location and status.
