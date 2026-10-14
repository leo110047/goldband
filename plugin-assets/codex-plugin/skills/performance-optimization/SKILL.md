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

Apply only the traps relevant to the changed execution path.

## Before Editing

- Trace the workload to the callee, conversion, or native implementation that
  owns the cost before choosing an optimization. Check effective build settings
  before adding tuning flags.
- For new bulk or parallel work, take the expected input scale and resource
  constraint from the task or current usage. Unknown scale is an assumption, not
  permission to invent a budget or build a caching or queueing subsystem.
- Passing correctness tests on small inputs does not establish scalability.
  Decide what would expose the relevant growth or allocation cost; unrelated
  edits need no benchmark. Investigate existing bugs with systematic-debugging.

## During Implementation

- Parallel execution can lose to serial work through startup, serialization,
  synchronization, or runtime constraints. Compare total workload cost against
  the serial implementation; more workers are a hypothesis.
- Trace intermediate allocations from producer to consumer: lazy evaluation
  followed by full materialization retains the same memory cost. Preserve
  required ordering, repeatability, and error behavior.
- Input-specific fast paths must preserve the public contract and its fallback.
  Behavior that depends on timing tools or caller identity is not a product
  optimization. Input specialization and caches need evidence of actual use.

## Before Claiming Improvement

- Fewer operations, a cache, or a complexity argument is a hypothesis. Measure
  the claimed metric (elapsed time, CPU work, or peak or retained memory)
  against a comparable baseline, with correctness checks retained. A faster run
  says nothing about memory.
- Record the baseline, candidate, workload, environment, and result in existing
  task evidence. Take acceptance limits from requirements or observed
  constraints.
- The benchmark must exercise the changed path at representative scale on the
  input dimension the change depends on. Report cold and warmed state separately
  when they affect the claim; repeated cached input hides uncached cost.
- Repeat comparable runs enough to tell the claimed gain apart from observed
  variation; when the difference stays within noise, report the result as
  inconclusive.
- Without execution, report the structural change and the unmeasured effect
  separately. Do not invent results or substitute an easier workload.

Use the project's measurement tools. Goldband's benchmark workflow aggregates
supplied samples; it does not profile CPU or memory.
