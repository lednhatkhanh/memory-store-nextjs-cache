# 21: Establish an isolated resource-measurement harness

**What to build:** Give maintainers a repeatable way to exercise the production cache package under a fixed workload and obtain trustworthy heap, RAM, CPU, event-loop, and cleanup evidence without allowing a failed measurement to destabilize the test coordinator.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A standalone child process imports the production package build, connects to an isolated disposable Redis instance, and runs a fixed, seeded workload with an explicit timeout.
- [x] The workload covers warm-up plus repeated cache reads, writes, tag invalidations, and supported concurrent streamed entries through public package APIs.
- [x] Each run records Node.js, package, Redis, operating-system, and architecture versions together with the workload parameters and thresholds used.
- [x] Structured evidence distinguishes V8 heap, external memory, ArrayBuffer and Buffer memory, current RSS, peak RSS, user and system CPU time, elapsed time, event-loop utilization and delay, and active resource types.
- [x] Measurements are taken at defined phases after consistent warm-up and test-only garbage-collection stabilization so results can be compared without relying on one noisy sample.
- [x] Threshold evaluation is executable and covered by fixtures that prove both a passing result and a deliberately exceeded budget are reported correctly.
- [x] The child is always terminated and all Redis resources are cleaned up after success, timeout, crash, or malformed output.
- [x] The normal package test loop remains fast; the resource harness has a dedicated documented command and does not silently pass through a Turborepo cache hit when a fresh measurement is requested.

## Comments

- 2026-09-16: Implemented the dedicated `pnpm measure:cache-resources` command. It directly rebuilds
  the production Rspack bundle, runs a seeded public-API workload in a GC-enabled child against a
  disposable Redis 8.2.1 container, validates IPC evidence and thresholds in the coordinator, and
  reports stabilized lifecycle and measured-batch samples. A real run on Node.js 24.21.0 / Darwin
  arm64 passed its thresholds, recorded 10–12 event-loop-delay samples per measured batch, closed
  Redis with only the coordinator IPC pipe active, left no child process, and created no surviving
  Redis container. Fast fixtures cover passing, exceeded, inconsistent, crash, timeout, and
  malformed-output outcomes. From a clean local clone, frozen installation and `pnpm verify` passed
  with 35 cache-package tests, 5 content-service tests, 5 web tests, and every production build; the
  clone remained clean. The final two-axis review reported no standards or spec findings.
