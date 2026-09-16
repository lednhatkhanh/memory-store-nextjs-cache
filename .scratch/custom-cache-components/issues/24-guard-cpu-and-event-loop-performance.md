# 24: Guard CPU and event-loop performance

**What to build:** Detect material CPU, throughput, and event-loop regressions in the cache package while avoiding flaky pass/fail decisions caused by shared-runner timing noise.

**Blocked by:** 21: Establish an isolated resource-measurement harness.

**Status:** ready-for-agent

- [ ] The existing Vitest benchmark runner measures the production package build rather than transformed source modules.
- [ ] Pure benchmarks cover entry encoding and decoding at small, representative, and maximum supported sizes plus freshness and tag classification at representative tag counts.
- [ ] Integration benchmarks cover fixed-operation Redis read, write, and invalidation cycles plus supported overlapping stream completion, cancellation, and rejection.
- [ ] Each result records throughput, sample count, relative margin of error, mean and percentile latency, user and system CPU time, event-loop utilization, and event-loop delay.
- [ ] Pure hot-path checks use stable absolute budgets or controlled-runner baselines; Redis and concurrent-stream checks use wider tolerances that account for container, network, and scheduling variance.
- [ ] Shared-runner validation fails only on a sustained material regression and retains comparison evidence instead of enforcing a narrow percentage against a laptop-generated baseline.
- [ ] Baseline generation is an explicit operation, and normal validation cannot overwrite its own comparison evidence.
- [ ] A failing run can be reproduced with Node.js CPU profiling enabled, but profiler output is diagnostic evidence and is not itself used to determine pass or fail.
