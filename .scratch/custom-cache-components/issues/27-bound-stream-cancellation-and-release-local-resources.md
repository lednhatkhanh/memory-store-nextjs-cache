# 27: Bound stream cancellation and release local resources

**What to build:** Ensure rejecting a streamed cache entry always releases handler-owned reservations and pending-write state within a bounded time, even when the upstream stream's cancellation never settles.

**Blocked by:** 07: Publish streamed cache entries atomically and within bounds.

**Status:** ready-for-agent

- [ ] Entry-size and aggregate-buffer rejection release handler-owned byte reservations without waiting indefinitely for upstream cancellation.
- [ ] A rejected write always leaves `pendingWrites` and `bufferedBytes` at their correct values within a documented bound.
- [ ] A same-key `get()` cannot wait forever on a rejected write whose stream ignores or delays cancellation.
- [ ] Cancellation failures remain observable without replacing the deterministic cache-rejection error or publishing a partial entry.
- [ ] The implementation avoids unhandled promise rejections when cancellation completes or fails after local cleanup.
- [ ] Public-API tests cover cancellation that resolves, rejects, and never settles, including a stream created through `ReadableStream.tee()` with another branch left open.
- [ ] Resource-churn tests prove repeated stuck-cancellation cases do not retain pending-map entries or consume the aggregate buffering budget.
- [ ] The documented lint exception and resource-safety contract describe the bounded cancellation behavior accurately.

## Comments

- 2026-09-17: Review reproduction configured a two-byte aggregate limit, emitted two two-byte
  chunks, and returned a never-settling cancellation promise. After 100 ms the write remained
  unsettled with `bufferedBytes: 2` and `pendingWrites: 1`; a same-key read consequently remained
  blocked behind that write.
