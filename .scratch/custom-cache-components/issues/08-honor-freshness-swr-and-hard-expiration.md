# 08: Honor freshness, stale-while-revalidate, and hard expiration

**What to build:** Make cache lifetime behavior match the pinned Next.js contract so callers can distinguish fresh reuse, intentional stale serving, and content that must no longer be served.

**Blocked by:** 05: Invalidate committed content across instances; 07: Publish streamed cache entries atomically and within bounds.

**Status:** resolved

- [x] Fresh entries are reused through both reference-application instances without unnecessary source reads.
- [x] The reference application demonstrates the supported `cacheLife` and revalidation setup in a form consumers can follow, with expected fresh, stale, and expired behavior documented.
- [x] Stale-while-revalidate serves stale content only within its configured policy and eventually makes the refreshed revision reusable.
- [x] Hard-expired entries are not served as fresh or stale and require a permitted source render.
- [x] The relevant expiration, refresh, and tag-update methods behave according to the exact pinned Next.js handler contract.
- [x] Boundary cases use a controllable clock for pure model tests and real Redis time with bounded polling for integration tests.
- [x] Tests distinguish immediate invalidation from stale-while-revalidate instead of weakening the immediate-invalidation correctness contract.
- [x] Immediate publication invalidation uses the pinned contract's expire-now behavior, while stale-serving APIs are used only for content whose documented policy permits an old value during refresh.
- [x] Delayed invalidation is covered only where supported by the pinned contract and documented as such.

## Comments

- 2026-09-16: The handler now classifies entry age using the pinned Next.js 16.3.5 strict
  boundaries: an entry remains fresh through its `revalidate` instant, remains available for
  stale-while-revalidate through its `expire` instant, and becomes a miss immediately afterward.
  Explicit and soft tag timestamps use the pinned strict ordering as well, and `getExpiration()`
  returns the maximum stored hard-expiration timestamp, including a future delayed deadline.
- 2026-09-16: Tag updates are one namespace-slot-local Lua operation with a separate update-order
  timestamp. A duration marks the tag stale immediately and optionally records its future hard
  deadline; a stale-only update preserves an existing deadline; and a newer expire-now update can
  shorten an older delayed deadline. Publication webhook requests still default to
  `revalidateTag(tag, { expire: 0 })`, so the opt-in stale policy cannot weaken immediate
  publication correctness.
- 2026-09-16: The reference application names its normal one-hour-revalidate/one-day-expire
  `publishedContent` profile. Content explicitly allowed to show an old value can request the
  documented `briefStaleContentRefresh` policy, which permits stale serving for at most two
  seconds while Next.js refreshes in the background. The two-process production scenario proves
  one source read for fresh reuse, one stale beta response, and eventual shared reuse of
  beta revision 2 with exactly one additional source read.
- 2026-09-16: Pure model tests use controlled epoch values for equality and one-millisecond boundary
  cases. Real-Redis tests use bounded polling to prove both entry-age and delayed-tag hard
  expiration, future `getExpiration()` values, stale-only deadline preservation, and a later
  expire-now update after a delayed policy.
- 2026-09-16: Cache duration conversion uses the pinned date-fns `secondsToMilliseconds` helper.
  Freshness comparisons remain numeric so fractional monotonic epoch timestamps retain their
  precision, with an explicit sub-millisecond boundary test.
- 2026-09-16: Next.js runtime verification used `/_next/mcp` and `agent-browser` 0.37.1. MCP
  reported no compilation, configuration, or browser-session errors; the browser rendered the
  checked-in welcome document without console errors; React diagnostics retained the two intended
  dynamic Suspense holes; and the development log recorded the remote-cache lookup.
- 2026-09-16: A fresh detached worktree completed a frozen install and cache-bypassed root
  `pnpm verify`, covering formatting, linting, type-checking, 36 tests, package builds, the
  production Next.js build, and disposable Redis scenarios.
- 2026-09-16: The two-axis review found unrecorded polling suppressions, duplicated polling,
  stale-only updates that erased a deadline, non-strict tag comparisons, and future expirations
  hidden from `getExpiration()`. Polling now uses suppression-free package recursion and Vitest's
  bounded waiter; the tag state model and atomic update script match the pinned contract; and all
  focused and clean-checkout gates pass. Evidence remains limited to the package and Next.js server
  cache layers on the verified standalone Redis-primary topology. Source replicas, unrelated HTTP,
  browser, CDN caches, and Memorystore for Redis Cluster remain outside this ticket's evidence.
