# 23: Enforce peak RAM limits under bounded concurrency

**What to build:** Prove that the cache package stays within an explicit total-memory envelope when many large streams overlap, and that excess work is rejected cleanly before heap or process memory becomes unsafe.

**Blocked by:** 21: Establish an isolated resource-measurement harness.

**Status:** resolved

- [x] The production package is exercised at, below, and above its documented per-entry and aggregate buffering limits with deterministic concurrent streams.
- [x] Supported workloads complete under an explicit V8 old-space ceiling and remain within documented peak heap, external-memory, ArrayBuffer, and RSS budgets.
- [x] Work beyond the supported envelope is rejected through the package's bounded diagnostic contract without replacing the last complete value, leaking a reservation, or crashing the process.
- [x] A Linux validation path enforces a kernel-level total-memory limit with swap behavior declared, while the Redis service has a separate quota so its memory is not attributed to the library process.
- [x] CPU quota and test timeout prevent a resource failure from hanging or monopolizing the validation worker.
- [x] Environments that cannot apply kernel quotas run the portable V8 and measurement checks but clearly report that total-RAM enforcement was skipped rather than claiming full evidence.
- [x] Repeated maximum-concurrency runs remain stable and record enough phase and peak data to distinguish a true regression from allocator fragmentation or runner noise.
- [x] Near-limit heap snapshots and diagnostic reports are captured only in an isolated failure rerun, with bounded retention and no real application data.

## Comments

- 2026-09-17: Extended the production-bundle resource harness with exact 8 MiB per-entry and
  32 MiB aggregate boundary checks, three repeated eight-stream maximum-concurrency runs, in-phase
  peak sampling, a 256 MiB V8 old-space ceiling, and explicit 192 MiB heap/external/ArrayBuffer plus
  640 MiB RSS budgets. Stabilized peak-run RSS medians also have a 96 MiB range gate; the final
  normal run's range was 19,283,968 bytes. Linux cgroup v2 enforcement uses 768 MiB total memory,
  zero swap, and 0.5 CPU;
  Redis is separately limited to 128 MiB and 0.5 CPU, while unsupported hosts report a skip reason.
  On Node.js 24.21.0 / Darwin arm64, the final portable run passed at 521,617,408 bytes peak RSS,
  100,758,504 bytes peak used heap, 156,865,712 bytes peak external memory, and 155,563,859 bytes
  peak ArrayBuffer/Buffer memory. Rejected writes preserved the prior payload and metadata
  fingerprint and released every reservation. Issue 22 remained green with 66,784 bytes retained
  heap growth, zero retained external and ArrayBuffer growth, zero positive active-resource delta,
  and natural Redis/child cleanup. While the first exact-limit peak was still held, an isolated
  diagnostic rerun produced exactly one 48,095-byte report and one 11,387,195-byte heap snapshot
  from synthetic data; the normal run produced neither.
  This host reported the combined Linux memory, swap, and CPU quota gate as skipped rather than
  claiming kernel-enforced evidence.
