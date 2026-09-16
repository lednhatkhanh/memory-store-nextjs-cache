# 07: Publish streamed cache entries atomically and within bounds

**What to build:** Store streamed Next.js cache values without exposing partial data, losing framework metadata, or allowing a single entry to consume unbounded memory.

**Blocked by:** 03: Prove one-instance Redis cache reuse with ioredis.

**Status:** resolved

- [x] A complete streamed entry round-trips through real Redis with the timing and cache metadata required by the pinned handler contract.
- [x] A reader can observe either the previously complete value or the newly complete value, never a partially published replacement.
- [x] A stream that throws, truncates, or is cancelled leaves no reusable partial entry.
- [x] Configured entry-size and buffering limits reject oversized values deterministically and expose a bounded diagnostic.
- [x] Malformed or version-incompatible stored entries are treated according to the documented safe-miss policy rather than being served.
- [x] Entry publication is atomic for the selected Memorystore-compatible Redis topology.
- [x] Unit tests cover serialization validation, while integration tests establish the behavior of actual streams and Redis operations.

## Comments

- 2026-09-16: Stored entries now use a versioned envelope that preserves the six fields in the
  pinned Next.js 16.3.5 `CacheEntry` contract. Payload length plus SHA-256 validation makes malformed,
  incompatible, or truncated Redis values safe misses; pre-versioned entries therefore miss after
  upgrade instead of being served with ambiguous metadata.
- 2026-09-16: A candidate stream is consumed before publication under an 8 MiB default logical-entry
  cap (metadata plus raw payload) and a 32 MiB default aggregate raw-payload buffer cap. Both are
  configurable. Limit failures cancel the upstream stream, keep the previous complete entry, and
  emit a fixed-shape diagnostic containing only reason and byte counts. Stream errors and aborts
  keep the previous entry and propagate the original failure. Under the Web Streams contract a
  normal close is the only source-completion signal; there is no separate expected source length.
- 2026-09-16: Publication remains one namespace-slot-local Lua compare-and-set followed by Redis
  `SET`, after the entire candidate and metadata are available. A second connection observes the
  previous complete entry while buffering and the new complete entry after publication. The selected
  verified topology is a standalone Redis primary endpoint, matching a Memorystore for Redis primary
  endpoint, exercised with `redis:8.2.1-alpine`. Hash-tag colocation keeps the operation compatible
  with Redis Cluster, but Memorystore for Redis Cluster was not integration-tested in this stage.
- 2026-09-16: Serialization unit tests cover complete round-trip metadata, malformed JSON, unsupported
  versions, invalid metadata, and truncated stored payloads. Real-Redis integration tests cover
  complete stream round trips, cross-connection publication visibility, thrown and aborted partial
  streams, actual upstream cancellation on rejection, both byte limits, invalidation, and publication
  fencing.
- 2026-09-16: Next.js runtime verification used `/_next/mcp` and `agent-browser` 0.37.1. MCP reported
  no compilation, configuration, or browser-session errors. The browser rendered the checked-in
  welcome document with no console errors, React diagnostics retained the two intended dynamic
  Suspense holes, and the development log recorded the remote-cache miss.
- 2026-09-16: A fresh detached worktree completed a frozen install and cache-bypassed root
  `pnpm verify`, covering formatting, linting, type-checking, 18 package tests, five web tests,
  production Next.js builds, and the disposable two-instance Redis scenario.
- 2026-09-16: The two-axis review found missing lint-policy records, an overstatement about failure
  diagnostics, incomplete accounting of metadata in the entry cap, weak cancellation evidence, and
  an ambiguous production-topology claim. The policy and README were corrected, metadata now counts
  toward the entry cap, the integration fixture observes the upstream `cancel()` callback, and the
  verified standalone topology plus Cluster limitation are explicit.
