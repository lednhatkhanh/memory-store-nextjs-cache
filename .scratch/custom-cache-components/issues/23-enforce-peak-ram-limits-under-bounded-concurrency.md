# 23: Enforce peak RAM limits under bounded concurrency

**What to build:** Prove that the cache package stays within an explicit total-memory envelope when many large streams overlap, and that excess work is rejected cleanly before heap or process memory becomes unsafe.

**Blocked by:** 21: Establish an isolated resource-measurement harness.

**Status:** ready-for-agent

- [ ] The production package is exercised at, below, and above its documented per-entry and aggregate buffering limits with deterministic concurrent streams.
- [ ] Supported workloads complete under an explicit V8 old-space ceiling and remain within documented peak heap, external-memory, ArrayBuffer, and RSS budgets.
- [ ] Work beyond the supported envelope is rejected through the package's bounded diagnostic contract without replacing the last complete value, leaking a reservation, or crashing the process.
- [ ] A Linux validation path enforces a kernel-level total-memory limit with swap behavior declared, while the Redis service has a separate quota so its memory is not attributed to the library process.
- [ ] CPU quota and test timeout prevent a resource failure from hanging or monopolizing the validation worker.
- [ ] Environments that cannot apply kernel quotas run the portable V8 and measurement checks but clearly report that total-RAM enforcement was skipped rather than claiming full evidence.
- [ ] Repeated maximum-concurrency runs remain stable and record enough phase and peak data to distinguish a true regression from allocator fragmentation or runner noise.
- [ ] Near-limit heap snapshots and diagnostic reports are captured only in an isolated failure rerun, with bounded retention and no real application data.
