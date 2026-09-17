# 12: Degrade safely during Redis and source failures

**What to build:** Give applications bounded and observable behavior when Redis or the content source is slow or unavailable, without reporting failed invalidation as successful publication propagation.

**Blocked by:** 05: Invalidate committed content across instances; 07: Publish streamed cache entries atomically and within bounds.

**Status:** resolved

- [x] `ioredis` connection, command, reconnect, and retry behavior is bounded and documented for the selected deployment topology.
- [x] A cache read failure falls back to a fresh source render when policy and source availability permit it.
- [x] Cache write failure does not corrupt an existing complete entry or make a partial replacement reusable.
- [x] Invalidation failure is surfaced to the caller, remains observable and retryable, and is never translated into successful publication propagation.
- [x] Fastify can produce deterministic source delay, source failure, confirmed deletion, and recovery scenarios.
- [x] The reference application exposes production-appropriate loading, missing-content, and failure behavior through public routes while failure injection remains in the content service or test harness.
- [x] A confirmed missing document is distinguishable from a source outage or timeout.
- [x] Freshness-critical routes return an explicit unavailable state when authoritative freshness cannot be established; any last-good-content policy is separately approved and documented by route family.
- [x] Diagnostics expose hits, misses, source fallback, latency, invalidation failure, and rejected stale writes without logging content, credentials, or high-cardinality raw keys by default.
- [x] Concurrency under failure does not create a retry storm or unbounded queue of source renders.

## Answer

Redis operations now have bounded connection, command, retry, replay, and reconnect behavior. Cache
reads and writes degrade to an authoritative source render, while publication invalidation remains a
durable, observable, retryable operation that cannot return a false success. The content service
provides deterministic delay, failure, deletion, and recovery controls; the reference application
distinguishes confirmed missing content from source unavailability and serves no unverified
last-good value.

The production integration scenario pauses Redis, rejects invalidation, issues eight concurrent
requests with exactly one source read, exercises source failure and recovery, and retries
invalidation successfully. Focused cache, content-service, web-client, configuration, and
two-instance production tests pass. The running Next.js route was also verified through its public
loading, error/retry, recovery, and not-found UI seams.

## Comments

- 2026-09-17: Implemented in `0e11902`; two-axis review found no hard standards violations or scope
  creep. Review findings for cold-client invalidation diagnostics and metadata-floor stale-write
  diagnostics were corrected in `ba8bcf3`.
