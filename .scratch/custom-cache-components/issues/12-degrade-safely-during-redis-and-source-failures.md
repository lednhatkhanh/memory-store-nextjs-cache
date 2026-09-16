# 12: Degrade safely during Redis and source failures

**What to build:** Give applications bounded and observable behavior when Redis or the content source is slow or unavailable, without reporting failed invalidation as successful publication propagation.

**Blocked by:** 05: Invalidate committed content across instances; 07: Publish streamed cache entries atomically and within bounds.

**Status:** ready-for-agent

- [ ] `ioredis` connection, command, reconnect, and retry behavior is bounded and documented for the selected deployment topology.
- [ ] A cache read failure falls back to a fresh source render when policy and source availability permit it.
- [ ] Cache write failure does not corrupt an existing complete entry or make a partial replacement reusable.
- [ ] Invalidation failure is surfaced to the caller, remains observable and retryable, and is never translated into successful publication propagation.
- [ ] Fastify can produce deterministic source delay, source failure, confirmed deletion, and recovery scenarios.
- [ ] The reference application exposes production-appropriate loading, missing-content, and failure behavior through public routes while failure injection remains in the content service or test harness.
- [ ] A confirmed missing document is distinguishable from a source outage or timeout.
- [ ] Freshness-critical routes return an explicit unavailable state when authoritative freshness cannot be established; any last-good-content policy is separately approved and documented by route family.
- [ ] Diagnostics expose hits, misses, source fallback, latency, invalidation failure, and rejected stale writes without logging content, credentials, or high-cardinality raw keys by default.
- [ ] Concurrency under failure does not create a retry storm or unbounded queue of source renders.
