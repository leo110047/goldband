---
name: performance-optimization
description: |
  Use for slowness or memory pressure, performance claims, and changes
  to bulk processing, materialization, caching, or parallel execution where
  workload growth or resource cost affects the implementation. Catch coding-agent
  optimization traps before editing and during verification; no planning command
  is required. Skip unrelated small edits and speculative architecture tuning.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Performance and Resource Traps

Apply only the traps relevant to the changed execution path. These are
research-informed failure patterns, not a universal optimization checklist.

## Before Editing

- A short loop or familiar API can hide the actual cost in a callee, conversion,
  or native implementation. Trace the workload to that owner before choosing
  an optimization; check effective build settings before adding tuning flags.
- For new bulk or parallel work, establish the expected input scale and resource
  constraint from the task or current usage. Unknown scale is an assumption,
  not permission to invent a budget or build a caching/queueing subsystem.
- A correctness test passing on small inputs does not establish scalability.
  Decide what would expose the relevant growth or allocation cost; unrelated
  edits need no benchmark. Investigate existing bugs with systematic-debugging.

## During Implementation

- Parallel execution can lose to serial work through startup, serialization,
  synchronization, or runtime constraints. Compare total workload cost, not just
  the worker body. More workers are a hypothesis, not proof of speedup.
- Compact collection code can allocate full intermediate results or repeat
  conversions. Trace producer and consumer: a generator followed by full
  materialization can retain the same memory cost. Preserve required ordering,
  repeatability, and error behavior when changing evaluation strategy.
- Input-specific fast paths must preserve the public contract, including the
  fallback. Timing-tool detection or caller-name checks that only accelerate
  the evaluator are not product optimizations. Legitimate input specialization
  and caches need evidence for their actual use, not a blanket prohibition.

For source cases and limits of these patterns, read
[optimization-patterns.md](reference/optimization-patterns.md) when relevant.

## Before Claiming Improvement

- Fewer operations, a cache, or a better complexity argument supports a
  hypothesis; it does not prove elapsed-time or peak-memory improvement.
  Measure the metric being claimed against a comparable baseline and preserve
  correctness. A faster run alone says nothing about memory consumption.
- An agent-written benchmark can miss the changed path. Check that it exercises
  the target implementation and workload, then separate cold and warmed state
  where they affect the claim. Repeating the same cached input can hide the
  underlying cost; a small timing delta can be measurement noise.
- If execution is unavailable, report the inspected structural change and the
  unmeasured effect separately. Do not invent results or quietly replace a
  workload that fails with an easier one.

Read [profiling-techniques.md](reference/profiling-techniques.md) for these
measurement failure cases. Reuse the project's measurement tools. Goldband's
benchmark workflow aggregates supplied samples; it does not collect CPU or
memory profiles for the application.
