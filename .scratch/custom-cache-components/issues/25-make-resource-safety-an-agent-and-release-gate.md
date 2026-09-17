# 25: Make resource safety an agent and release gate

**What to build:** Make the cache package's resource contract part of normal agent behavior and release evidence so changes affecting memory ownership, concurrency, or hot paths cannot bypass the relevant automated checks or silently weaken their budgets.

**Blocked by:** 16: Establish CI and release evidence; 22: Detect retained heap and resource leaks after cache churn; 23: Enforce peak RAM limits under bounded concurrency; 24: Guard CPU and event-loop performance; 27: Bound stream cancellation and release local resources; 28: Account for owned memory behind stream chunks.

**Status:** ready-for-agent

- [ ] Package-scoped agent guidance identifies buffering, streaming, serialization, pending-write state, Redis lifecycle, invalidation, and hot-path changes that require focused resource validation.
- [ ] The guidance names the exact fast check, retained-resource check, bounded-RAM check, and CPU benchmark commands agents must run for the corresponding change class.
- [ ] Agents may not weaken a threshold or refresh a benchmark baseline in the same change without recording the measured cause, before-and-after evidence, and reviewer-visible rationale.
- [ ] Pull-request validation runs deterministic semantic cleanup checks and any resource checks proven stable on the selected runner.
- [ ] Scheduled or release validation runs the complete heap, kernel-enforced RAM, repeated-concurrency, CPU, and event-loop suite from a clean production build with Turborepo measurement caching bypassed.
- [ ] Resource failures retain structured evidence, logs, reproduction commands, and isolated Node.js diagnostic artifacts while excluding environment variables, secrets, and real cache values.
- [ ] Release evidence records the exact workload envelope, platform, runtime, Redis, thresholds, skipped guarantees, and results so support claims remain bounded and reproducible.
- [ ] MemLab remains an optional escalation tool for difficult retainer analysis, and no unmaintained profiler becomes a required dependency or release gate.
- [ ] Strict relative benchmark gating is enabled only on a pinned dedicated environment or an explicitly approved continuous-benchmark service; shared runners retain generous ceilings and evidence instead.
