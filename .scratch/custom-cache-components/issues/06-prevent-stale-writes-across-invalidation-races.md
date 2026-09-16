# 06: Prevent stale writes across invalidation races

**What to build:** Ensure that renders started before an invalidation, and older renders completing during overlapping publications, can never restore content that is reusable after a newer committed revision.

**Blocked by:** 05: Invalidate committed content across instances.

**Status:** resolved

- [x] The chosen timestamp or generation strategy is documented with its ordering, atomicity, and clock assumptions.
- [x] The Fastify content service can pause a selected response after it captures a revision and signal exactly when that barrier is reached.
- [x] A deterministic scenario uses the reference application's normal render and invalidation seams to warm revision 1, pause an old render, commit and invalidate revision 2, then release the old render; pause/release controls remain in the content service.
- [x] The already-running request may complete with revision 1, but every subsequent server request through either instance returns revision 2.
- [x] An overlapping-publication scenario proves that an older completion cannot replace the newest valid revision.
- [x] Seeded model tests generate reads, writes, invalidations, and ordering changes and print a reproducible trace when an invariant fails.
- [x] Failure diagnostics record revision identifiers and operation ordering without relying on arbitrary sleeps.

## Comments

- 2026-09-16: Cache publication now treats Next.js's cache-entry timestamp as a fencing value.
  A namespace-slot-local Redis Lua operation rejects a candidate when an explicit tag was made
  stale at or after its render start, a hard-expiration boundary was reached at or after that
  start, or an entry with an equal/newer start already won. Future hard-expiration deadlines do
  not block a fresh render before the deadline. The README records Redis atomicity, conservative
  equality, key colocation, and the synchronized, monotonic, sufficiently resolved host-clock
  assumption.
- 2026-09-16: The Fastify support service owns arm, reached, and release endpoints for selected
  responses. Its long-polling reached barrier returns the captured revision, so scenarios coordinate
  through events rather than sleeps and a paused response retains its captured document across a
  later commit.
- 2026-09-16: The production scenario warms revision 1 across two processes, expires it to begin a
  controlled old render on instance A, observes revision 1 at the source barrier, commits revision
  2, invalidates through instance B, and lets B publish revision 2 before releasing A. A's already
  running request completes with revision 1; later requests through A and B return revision 2 with
  the source-read count fixed at three. Ordered revision events and process logs are attached to
  failures. Unrelated alpha content remains reusable.
- 2026-09-16: Package tests cover pre-invalidation completion, reverse completion order, and a
  nonzero deferred-expiration profile. The seeded model uses seed `0x5a17e`, exercises reads,
  invalidations, pending writes, and randomized completion order, and prints the seed plus its
  full operation/revision trace on failure.
- 2026-09-16: Next.js 16.3.5 runtime verification used `/_next/mcp` and `agent-browser` 0.37.1.
  MCP reported no compilation, configuration, server, or browser-session errors. The browser
  rendered the checked-in welcome revision through the remote handler, React diagnostics retained
  the two intended dynamic Suspense holes, and the development log recorded the cache miss.
- 2026-09-16: A fresh detached worktree completed a frozen install and cache-bypassed root
  `pnpm verify`, covering formatting, linting, type-checking, 17 tests, all package builds, the
  production Next.js build, and disposable Redis scenarios.
- 2026-09-16: The two-axis review initially found duplicated cache-entry fixtures, incorrect
  handling of future hard-expiration timestamps, partial ordering diagnostics, and the missing
  completion record. The fixtures were centralized, deferred expiration gained a regression test
  and deadline-aware fence, ordered diagnostics were added, and the final Standards and Spec
  reviews reported no remaining findings. Evidence is limited to explicit tags and the package's
  Redis/Next.js boundary; implicit/path tags, streaming bounds, SWR policy, source replicas, HTTP
  caches, browsers, and CDNs remain separate work.
