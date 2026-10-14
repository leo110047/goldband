---
name: testing-strategy
description: |
  Use when designing new tests, choosing test layers, improving coverage for a
  concrete risk, or stabilizing flaky tests before they become debugging sessions.

  Best fit for test design and reliability, not investigating failing behavior.
  Prefer the Goldband qa workflow for browser, staging, or full workflow QA.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Write
  - Edit
---

# Testing Strategy

Choose the cheapest test that proves the behavior at the boundary where the
risk lives. Do not optimize for a fixed unit/integration/E2E ratio; optimize for
evidence quality, runtime cost, and regression value.

## Use When

- Designing tests for new behavior or a contract change.
- Deciding whether unit, integration, E2E, fixture, or manual QA evidence is
  appropriate.
- Improving coverage where a concrete risk is not currently protected.
- Stabilizing flaky tests before they become a debugging task.

Use `systematic-debugging` instead when an existing test is unexpectedly
failing or behavior is already broken.

## Test Selection

- Unit tests fit deterministic business logic, parsing, validation, and edge
  cases that do not need real infrastructure.
- Integration tests fit API, database, queue, filesystem, provider adapter, and
  producer/consumer contracts.
- E2E tests fit critical user journeys where confidence depends on real wiring,
  routing, browser behavior, or deployed surfaces.
- Manual QA is acceptable only when the behavior cannot be automated cheaply;
  record exact steps, environment, and observed result.

## Quality Bar

- Test behavior and outcomes, not implementation details.
- Cover the failing input, contract edge, or user path that would regress.
- Keep tests independent and reset shared state.
- Avoid arbitrary sleeps; wait for real conditions.
- Mock external systems, not the code under test.
- Treat coverage percentage as a signal, not proof of safety.

## Completion Check

Before claiming testing work is complete, name:

- the risk being protected;
- the test layer chosen and why;
- the command or manual evidence used;
- any important path intentionally left untested.
