# Resource-regression testing for the cache library

## Decision

Use Node.js 24's built-in diagnostics plus the repository's pinned Vitest 5 benchmark runner as the
mandatory stack. Do **not** add MemLab, Clinic.js, or a flamegraph package as a mandatory test
dependency.

The first resource gate should run a standalone Node child process against the production Rspack
bundle and the existing disposable Redis fixture. Launching a child keeps an intentional OOM,
timeout, or profiler failure out of the Vitest coordinator; Node's child-process API supports hard
timeouts and exposes termination status to the parent
([Node child-process documentation](https://nodejs.org/docs/latest-v24.x/api/child_process.html)).
The child should run with a small, explicit V8 old-space ceiling, exposed GC for test-only
stabilization, fatal-error reports, and a dedicated artifact directory. Node documents
`--max-old-space-size`, `--expose-gc`, `--report-on-fatalerror`, `--cpu-prof`, `--heap-prof`, and
near-limit heap snapshots in the pinned release line
([Node 24 CLI documentation](https://nodejs.org/docs/latest-v24.x/api/cli.html)).

This gives two different guarantees, both of which are needed:

1. A repeatable workload does not retain JavaScript heap, Buffer/ArrayBuffer memory, Redis
   connections, timers, or the handler's per-write bookkeeping after cleanup.
2. The workload completes under explicit heap, total-memory, elapsed-time, and CPU budgets.

No test can prove that a library will *never* cause a resource problem for every input. The useful
contract is instead: bounded documented inputs, concurrency, and entry sizes stay within measured
budgets; adversarial oversized/cancelled/failed streams release their reservations; representative
throughput does not regress beyond an agreed threshold.

## Repository fit

The workspace pins Node `24.21.0`, Vitest `5.0.1`, pnpm, Turborepo, and Rspack. The cache package
already has public-seam Redis integration tests using a disposable `redis:8.2.1-alpine` container,
and it already bounds both one entry and aggregate concurrently buffered bytes. The resource suite
should extend that same public seam, but run the workload from the built package rather than from
source. Vitest specifically recommends benchmarking a library's built artifact to avoid Vite module
getter overhead inside hot loops
([Vitest benchmarking guidance](https://vitest.dev/guide/benchmarking#module-runner-overhead)).

Keep resource tests out of the ordinary fast unit-test loop. Give them dedicated package commands,
then let the eventual CI ticket decide which are blocking on every pull request and which run on a
scheduled or dedicated runner. This also prevents Turborepo cache hits from being mistaken for a
fresh measurement.

## Mandatory test design

### 1. Retention and memory ceilings

The parent test starts one Redis Testcontainer, builds the package, and passes only its connection
coordinates to an isolated workload child. The child imports the production bundle and executes
fixed, seeded phases:

- warm up the JIT and ioredis connection;
- repeatedly `set`/`get` bounded entries across both reused and unique keys;
- overlap streams up to the configured aggregate buffer limit;
- cancel and fail streams at different chunk boundaries;
- invalidate tags and complete older writes after invalidation;
- close every duplicate Redis client and discard every handler reference.

After warm-up and after each identical steady-state batch, force several test-only GCs, yield an
event-loop turn, and record `heapUsed`, `external`, `arrayBuffers`, and RSS. These dimensions must be
kept separate: Node defines `heapUsed` as V8 memory, `external` as memory attached to V8-managed
objects, `arrayBuffers` as ArrayBuffer/SharedArrayBuffer memory including Node Buffers, and RSS as the
whole process resident set. Node also warns that Linux RSS can grow despite a stable heap because of
allocator fragmentation
([Node 24 process memory documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage)).
Therefore, fail on a sustained post-warm-up retained-growth budget for heap/external/ArrayBuffers,
not on one sample or exact equality; treat RSS as a separate coarse ceiling and diagnostic trend.

Also record `process.resourceUsage().maxRSS` and CPU counters. In Node 24, `maxRSS` is the peak
resident set in KiB and CPU times are in microseconds
([Node 24 resource usage](https://nodejs.org/docs/latest-v24.x/api/process.html#processresourceusage)).
Compare the multiset of `process.getActiveResourcesInfo()` values before setup and after complete
cleanup; this stable Node 24 API reports the resource types keeping the event loop alive, making it a
useful socket/timer leak signal, though not a unique handle identity
([Node 24 active resources](https://nodejs.org/docs/latest-v24.x/api/process.html#processgetactiveresourcesinfo)).

The semantic assertions are more deterministic than byte measurements and should be the primary
gate: every reserved byte must become available after success, cancellation, and failure; pending
same-key writes must disappear after settlement; all clients must close; the child must exit before
the timeout. Use memory deltas as a secondary bounded-growth gate with generous, runner-calibrated
headroom.

`--max-old-space-size` constrains only V8 old space, so it is not a total-RAM limit
([Node 24 CLI documentation](https://nodejs.org/docs/latest-v24.x/api/cli.html#--max-old-space-sizesize-in-mib)).
For a true total-memory kill boundary, run the workload child in a Linux cgroup/container with fixed
memory and no extra swap. Docker documents hard memory and CPU constraints, while Testcontainers'
`withResourcesQuota` exposes memory-in-GiB and CPU quotas when the runtime is not rootless
([Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/),
[Testcontainers resource quotas](https://node.testcontainers.org/features/containers/#with-resources-quota)).
The existing Redis container should have its own quota so Redis memory cannot be confused with the
library process. On developer machines or rootless runtimes, the V8 ceiling and measured RSS remain
portable fallbacks, but the suite must report that the total-RAM guarantee was skipped.

### 2. CPU and latency regressions

Use Vitest 5's existing `*.bench.ts` support rather than adding Tinybench directly. Vitest's built-in
provider is Tinybench, runs benchmark files separately and serially, supports assertions and retries,
and reports throughput, mean, percentiles, relative margin of error, and sample count
([Vitest benchmarking](https://vitest.dev/guide/benchmarking)). Benchmark at least:

- pure entry encode/decode at small, typical, and maximum accepted sizes;
- freshness/tag classification with representative tag counts;
- a fixed-count Redis `set`/`get`/invalidate cycle using the production bundle;
- overlapping stream completion, cancellation, and rejection at the supported concurrency bound.

The pure cases can be strict and fast. Redis cases should use wider thresholds because container
startup, scheduling, networking, and Redis itself add variance. Capture `process.cpuUsage()` around a
fixed operation count so CPU time is not conflated with Redis wait time; Node returns user and system
CPU microseconds and supports delta readings
([Node 24 CPU usage](https://nodejs.org/docs/latest-v24.x/api/process.html#processcpuusagepreviousvalue)).
Capture event-loop utilization and p99 delay as diagnostics: ELU measures time outside the event
provider, while `monitorEventLoopDelay()` records delay in nanoseconds
([Node 24 performance hooks](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#perf_hookseventlooputilizationutilization1-utilization2),
[event-loop delay](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)).

Vitest can persist JSON results, compare them through `bench.from()`, assert relative or absolute
performance, add a tolerance `delta`, and retry noisy failures. Its documentation also explicitly
warns that benchmark results vary significantly across machines and says a single environment should
own stored baselines
([Vitest stored results and stability](https://vitest.dev/guide/benchmarking#storing-and-replaying-results)).
Consequently:

- Do not make a laptop-generated wall-clock baseline a blocking CI contract.
- On shared runners, start with result artifacts and generous CPU/latency ceilings; require a
  sustained material regression, not a tiny percentage change.
- For strict automatic PR-to-base statistical regression checks, use a dedicated pinned runner or an
  optional continuous-benchmark service. CodSpeed supports Vitest, configurable per-benchmark
  regression thresholds, and low-noise hosted macro runners, but introduces an external service,
  CI action, and repository configuration
  ([CodSpeed CI integration](https://codspeed.io/docs/integrations/ci),
  [CodSpeed thresholds](https://codspeed.io/docs/features/customization),
  [CodSpeed measurement model](https://codspeed.io/docs/what-is-codspeed)).

### 3. Failure artifacts, not profiler-dependent pass/fail

Always emit a compact JSON summary containing versions, platform, workload parameters, phase
samples, peaks, CPU time, elapsed time, event-loop statistics, active-resource deltas, and the exact
thresholds used. If the resource gate fails, rerun the isolated child with Node's stable CPU and heap
sampling profilers and retain the `.cpuprofile`, `.heapprofile`, fatal diagnostic report, and logs.
Use a near-limit `.heapsnapshot` only in the isolated rerun: Node warns that creating a heap snapshot
blocks the event loop and can require about twice the heap, risking another OOM
([Node heap snapshot API](https://nodejs.org/docs/latest-v24.x/api/v8.html#v8getheapsnapshotoptions)).

Profiles should diagnose failures, not determine pass/fail, because profiling changes timing and
allocation behaviour. Only synthetic cache values/tags should be used; heap snapshots and reports
can retain application data and environment details. Use Node's report environment-exclusion option
and short artifact retention where supported
([Node diagnostic reports](https://nodejs.org/docs/latest-v24.x/api/report.html)).

## Tool assessment

| Tool | Recommendation | CI determinism and trade-off |
| --- | --- | --- |
| Node 24 built-ins | **Mandatory** | Exact match to the pinned runtime, no dependency, provides memory/CPU/resource counters, ceilings, reports, and standard DevTools profiles. Explicit GC is test-only and byte thresholds still need headroom. |
| Vitest 5 benchmark fixture (Tinybench provider) | **Mandatory** | Already pinned; serial benchmark execution, statistics, stored baselines, assertions, deltas, and retries. Wall-time remains noisy on shared runners, so strict blocking comparisons need a controlled environment. |
| Existing Testcontainers + Docker quotas | **Mandatory in Linux CI for total-RAM proof** | Reuses the disposable Redis topology and offers kernel-enforced ceilings. Resource quotas are unavailable on rootless runtimes, so detect and report that limitation. |
| CodSpeed | **Optional after CI exists** | Best fit for automated low-noise PR regression history and thresholds, but adds a hosted service/action and should be a separate repository decision. |
| MemLab `@memlab/core` | **Optional diagnostic experiment only** | Officially supports Node heap assertions and V8 heap analysis, including checking whether a class remains after references are released ([MemLab repository](https://github.com/facebook/memlab#memory-assertions)). It parses large heap graphs and snapshot-based assertions are slower and more GC-sensitive than the proposed semantic/plateau gate; add it only if built-in snapshots cannot identify retainers. |
| Autocannon | **Optional reference-app load test** | Useful for the Next.js HTTP route and reports latency/throughput percentiles, but it is not a direct cache-library benchmark and its own documentation warns the JavaScript load generator can become CPU-bound ([Autocannon documentation](https://github.com/mcollina/autocannon#limitations)). Keep it out of the core package gate. |
| Clinic.js | **Do not adopt** | Its official repository says it is not actively maintained and may be inaccurate because of its ties to Node internals ([Clinic.js repository](https://github.com/clinicjs/node-clinic)). Node's supported profilers produce the needed artifacts. |

## Recommended rollout order

1. Define supported workload envelopes and implement the isolated production-bundle retention harness,
   semantic cleanup assertions, V8 ceiling, timeout, JSON evidence, and disposable Redis reuse.
2. Add Linux total-memory/CPU container limits and automatic Node diagnostic artifacts for failures.
3. Add Vitest 5 microbenchmarks and fixed-operation CPU/latency measurements; collect a baseline on
   one pinned CI runner before choosing blocking thresholds.
4. Document contributor/agent rules: run the focused resource harness when touching buffering,
   streaming, serialization, pending-write state, ioredis lifecycle, or invalidation; never weaken a
   threshold or refresh a baseline in the same change without explaining the measured cause.
5. Consider CodSpeed only when CI ownership and external-service policy are decided. Keep MemLab as
   an escalation tool for an observed, hard-to-explain retainer rather than routine test weight.
