# Session Handoff and Continuity

## Baseline Policy

A session's durable output is not only the diff. Decisions, direction
reversals, and hard-won constraints must land where the next session can find
them without relying on the current conversation. Conversation history is not
reliable cross-session storage.

## Where Durable Facts Go

- Repo-scoped decisions with lasting architectural or process consequences:
  record the decision, rationale, and implementation contract using the
  repository's existing convention. Do not create a new record unless the
  repository or user requires it.
- Cross-session task state, direction reversals, and user preferences not
  derivable from the repo: persistent memory only when host policy allows it
  and the user explicitly asks; otherwise use a repo-local handoff/report.
  Use absolute dates and omit or redact sensitive data.
- Investigations that another session must continue: preserve only findings
  and the next step that cannot be recovered from code, tests, or git history,
  using an existing repo record or authorized memory. Do not invent a handoff
  location.
- Facts the repository already records are not duplicated into memory or
  decision logs.

## Required Behavior

- Before ending work another session must continue, leave the shortest useful
  handoff: what was tried, what is verified versus suspected, and the single
  next step.
- Convert relative dates to absolute dates before persisting anything.
- When a new decision reverses an earlier record, update or mark the old
  record as superseded. Never leave two conflicting records live.
- Treat recalled memory as a point-in-time observation: verify that files,
  flags, or commands it names still exist before acting on them.

## Failure Signals

- The next session re-derives something this session already established.
- Two live records contradict each other.
- Memory entries restate what `git log` already shows.
