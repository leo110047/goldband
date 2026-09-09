# Measurement Traps in Agent Work

## Static Reasoning Presented as Measured Benefit

[How Do Agents Perform Code Optimization?](https://arxiv.org/abs/2512.21757)
compared 324 agent-authored and 83 human-authored performance PRs. Explicit
performance validation appeared in 45.7% and 63.6%, respectively. This measures
reported PR evidence, not proof that no unreported measurement happened.

For an improvement claim, retain the baseline, candidate, workload, environment,
and relevant result in existing task evidence. Match the metric to the claim:
elapsed time, CPU work, and peak or retained memory answer different questions.
Use requirements or observed constraints for acceptance limits, not universal
bundle-size or latency numbers.

## A Benchmark That Does Not Expose the Target Cost

[SWE-fficiency, appendix I](https://arxiv.org/html/2511.06090v2) compared model-
generated and manually annotated workloads against the same expert patches.
47% of generated workloads did not show a statistically significant delta.
The experiment used a particular model and suite; it is not an all-agent rate.

Verify the actual target call path and representative input scale. Cover the
input/state dimension the change depends on, rather than increasing data size
blindly. Keep correctness checks alongside timing; do not alter expected
behavior to obtain a speedup.

## Warm State and Timing Noise

SWE-fficiency appendix J describes timing gains from state carried between
repetitions. Report cold and warmed behavior separately when relevant; isolate
state when the claim concerns uncached computation. Do not mandate cold-only
measurements for a product whose benefit intentionally depends on cache reuse.

[Are Performance-Optimization Benchmarks Reliably Measuring Coding Agents?](https://arxiv.org/html/2607.01211v1)
found that some reported reference gains were small relative to replay variation
or changed across machines. Repeat comparable runs sufficiently to distinguish
the claimed gain from variation; a single faster run is inconclusive when the
difference is within the observed noise. Do not treat leaderboard scores as
universal capability measurements.
