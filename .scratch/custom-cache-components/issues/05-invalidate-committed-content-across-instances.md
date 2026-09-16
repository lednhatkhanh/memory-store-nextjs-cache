# 05: Invalidate committed content across instances

**What to build:** Make a committed content revision invalidated through one instance of the Next.js reference application become immediately unavailable as stale reusable content through every instance sharing the cache.

**Blocked by:** 04: Prove shared cache reuse across two instances.

**Status:** resolved

- [x] The test commits revision 2 before requesting invalidation through instance A's production-appropriate Next.js revalidation boundary.
- [x] Deterministic commit, reset, and inspection controls remain in the content service or test harness; consumer-facing application paths contain no test-only invalidation bypass.
- [x] Successful invalidation updates durable shared tag state in Redis; Pub/Sub, if used, is only an optimization.
- [x] After invalidation completes, new server requests through instances A and B return revision 2 and cannot reuse revision 1.
- [x] Explicit tags used by cached content participate in invalidation through the pinned plural handler contract.
- [x] Invalidating one dependency leaves unrelated tagged content reusable and avoids an unnecessary source request for it.
- [x] The scenario asserts source revision and source-read counts so a direct handler result cannot masquerade as successful framework integration.
- [x] Completion means package invalidation succeeded; it does not claim that unrelated HTTP, client, source-replica, or CDN caches are fresh.

## Comments

- 2026-09-16: Cached published documents now carry a tag derived from validated site, locale,
  and slug dimensions. The authenticated `POST /api/revalidate/content` Route Handler uses the
  pinned Next.js `revalidateTag(tag, { expire: 0 })` contract; deterministic commit, reset, and
  read-count controls remain confined to the Fastify support service.
- 2026-09-16: The plural Redis cache handler persists tag staleness and hard-expiration timestamps
  in namespace-scoped sorted sets. Reads consult that durable state directly, so invalidation does
  not depend on Pub/Sub or process-local state. A package test proves that one handler instance
  invalidates only the matching entry served by another handler instance.
- 2026-09-16: The production scenario warms revision 1 and unrelated `alpha` content, commits
  revision 2, invalidates through instance A, and requests instance B first so B must observe the
  durable invalidation before either instance can replace the shared entry. Both B and A render
  revision 2 with the welcome source count fixed at 2. `alpha` remains reusable with one source
  read. This verifies the package integration only; HTTP, browser, source-replica, and CDN cache
  freshness remain outside the claim.
- 2026-09-16: Next.js 16.3.5 runtime verification used `/_next/mcp` and `agent-browser` 0.37.1.
  MCP reported no compilation, configuration, or browser-session errors. The browser rendered the
  route, retained the expected dynamic Suspense boundaries, completed authenticated revalidation,
  and the subsequent navigation logged a remote-cache miss before rendering source content.
- 2026-09-16: A fresh temporary clone completed a frozen install and cache-bypassed root
  `pnpm verify`, covering formatting, linting, type-checking, 12 tests, package builds, the
  production Next.js build, and all disposable Redis scenarios.
- 2026-09-16: The two-axis review found no hard standards violations. Its two duplication smells
  were removed by centralizing epoch-millisecond sampling and reusing the stream fixture. The spec
  review found that requesting A before B could let A replace the old shared entry without proving
  B observed invalidation; the scenario now requests B first and the final clean-checkout gate
  passes with that stronger proof.
