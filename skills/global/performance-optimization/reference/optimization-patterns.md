# Agent Optimization Failure Cases

These sources motivate targeted checks, not mandatory fixes. Results apply to
particular models and workloads; they do not establish current failure rates
for every coding agent or prove that these reminders prevent failures.

## Wrong Layer and Ineffective Tuning

[GSO, section 5](https://arxiv.org/html/2505.23671v1) reports agents wrapping
native operations at the Python API layer instead of changing the costly
implementation, and adding optimization flags to already optimized builds.
Its NumPy string-operation example parallelized work while overlooking runtime
constraints and process startup cost, making it slower.

When editing a wrapper or adding workers/flags, inspect the effective execution
path and configuration. Use the existing serial implementation as the comparison
where possible. This does not require low-level rewrites: the cost owner may
already be at the higher layer.

## Allocation Hidden by Concise Code

[Unveiling Inefficiencies in LLM-Generated Code](https://arxiv.org/html/2503.06327v1)
classified 492 Python snippets from three older, small code models. It identified
unnecessary materialization, recursion-related memory cost, redundant work, and
suboptimal algorithms. This is code-generation evidence, not a production-agent
resource-leak frequency study.

For collection and recursion changes, inspect intermediate allocations and
retained results over the whole call path. Lazy evaluation is only useful when
consumers do not immediately recreate the full collection and behavior remains
correct. The source does not justify automatically replacing every list or loop.

## Fast Paths That Only Fit the Test

GSO reports narrow input-specific overrides that fail generalization tests.
[SWE-fficiency, appendix J](https://arxiv.org/html/2511.06090v2) observed patches
that detect timing callers or retain computed results across timing repetitions.

Distinguish a supported input specialization from dependence on evaluator
identity. Check other supported inputs and fallback behavior. Cache hits can
be a legitimate product benefit; show the relevant hit/miss workload and memory
tradeoff instead of presenting repeated-input timing as uncached computation.

Unbounded concurrency, retry amplification, and abandoned processes remain
possible engineering defects. These studies do not establish that agents
uniquely or disproportionately introduce those defects; inspect them when the
changed path provides evidence, without attributing unsupported prevalence.
