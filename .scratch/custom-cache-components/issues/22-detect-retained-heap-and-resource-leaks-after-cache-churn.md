# 22: Detect retained heap and resource leaks after cache churn

**What to build:** Automatically reject changes that retain cache payloads, bookkeeping, connections, timers, or other process resources after completed and failed cache activity should have released them.

**Blocked by:** 21: Establish an isolated resource-measurement harness.

**Status:** resolved

- [x] The isolated workload repeatedly completes successful writes and reads across both reused and unique keys until it reaches a measured steady state.
- [x] Separate phases exercise rejected oversized entries, upstream stream errors, cancellation at multiple chunk boundaries, overlapping writes, and invalidation while a write is pending.
- [x] After each phase, every buffered-byte reservation and same-key pending-write record is released and the handler can accept the full configured capacity again.
- [x] All workload-owned Redis clients, timers, streams, and other active resources are closed or settled, and the child exits without relying on a forced successful termination.
- [x] Post-warm-up heap, external-memory, and ArrayBuffer trends remain within documented retained-growth budgets across repeated equivalent batches rather than requiring exact byte equality.
- [x] The gate is demonstrated to fail against a controlled fixture that intentionally retains payload or bookkeeping state, proving the test detects a real leak instead of only collecting metrics.
- [x] Failures preserve the seed, phase samples, active-resource delta, configured limits, and a concise reproduction command without retaining real cached content or secrets.
- [x] The package documentation explains the tested workload envelope and states that the result is evidence for bounded supported usage, not a guarantee for every possible input.

## Comments

- 2026-09-16: Extended the production-bundle child with repeated reused/unique-key steady-state
  batches and isolated oversized, upstream-error, cancellation, overlapping-write, and pending-write
  invalidation phases. The handler now exposes content-free aggregate resource state; each phase
  recorded zero buffered bytes and pending writes after settlement and then accepted the full 16 KiB
  configured capacity. Median first-to-last retained growth has explicit 4 MiB heap and 1 MiB
  external/ArrayBuffer budgets, cleanup permits no positive active-resource delta, and a controlled
  retained-payload fixture fails those gates. A seeded Node.js 24.21.0 / Darwin arm64 run exited
  naturally and passed with 73,192 bytes of retained heap growth, no retained external or
  ArrayBuffer growth, and no positive active-resource delta.
- 2026-09-17: Re-verified the completed leak gate while adding issue 23's peak-concurrency phases.
  The seeded production-bundle run still exercised every success and failure phase, recorded zero
  buffered bytes and pending writes after each phase, accepted full configured capacity again, and
  exited naturally after closing Redis. It passed with 66,784 bytes retained heap growth, zero
  retained external and ArrayBuffer growth, and zero positive active-resource delta. The controlled
  retained-payload fixture remains covered by the focused evaluator test, and the package test suite
  passed all 40 tests.
