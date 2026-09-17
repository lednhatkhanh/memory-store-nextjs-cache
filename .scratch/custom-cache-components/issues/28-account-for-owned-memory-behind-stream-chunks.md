# 28: Account for owned memory behind stream chunks

**What to build:** Make the streaming memory limits bound the memory the handler actually retains, including backing buffers, fragment overhead, empty chunks, and serialization copies.

**Blocked by:** 23: Enforce peak RAM limits under bounded concurrency; 27: Bound stream cancellation and release local resources.

**Status:** ready-for-agent

- [ ] The handler does not retain a small `Uint8Array` view while unintentionally retaining a much larger caller-owned backing `ArrayBuffer`.
- [ ] Stream chunks are copied, coalesced, or otherwise owned in a form whose retained memory is included in the configured limits.
- [ ] Empty and highly fragmented streams cannot accumulate unbounded objects without consuming an enforced budget.
- [ ] Entry and aggregate limits account for metadata, payload ownership, fragmentation overhead, and material serialization copies under a documented policy.
- [ ] Public-API tests cover empty chunks, many one-byte chunks, small views over oversized backing buffers, concurrent writes, rejection, and normal completion.
- [ ] The isolated resource harness measures adversarial chunk geometry and proves retained and peak memory stay within the declared envelope after garbage collection.
- [ ] Diagnostics report stable, bounded measurements without exposing cache keys, namespaces, or payload data.
- [ ] Package documentation states exactly which memory is covered by each limit and any runtime overhead that remains outside a hard byte-for-byte guarantee.

## Comments

- 2026-09-17: A production-bundle probe configured a 32-byte aggregate limit and retained sixteen
  one-byte views over separate 1 MiB backing buffers. After garbage collection the handler reported
  16 buffered bytes while ArrayBuffer memory had grown by 16,711,680 bytes. Zero-length chunks can
  also add retained objects without increasing the current counter.
