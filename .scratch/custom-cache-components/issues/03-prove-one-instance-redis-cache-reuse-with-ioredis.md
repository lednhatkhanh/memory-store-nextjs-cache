# 03: Prove one-instance Redis cache reuse with ioredis

**What to build:** Make one production-built instance of the Next.js reference application serve revisioned content through the custom cache handler, proving that Redis-backed warm reads avoid unnecessary source requests.

**Blocked by:** 02: Adopt Cache Components and Partial Prefetching.

**Status:** resolved

- [x] A Fastify content service can read, commit, count reads for, and reset revisioned documents independently of Redis.
- [x] Testcontainers starts an isolated, pinned Redis image for the integration scenario and cleans it up reliably.
- [x] The package exposes `ioredis` as its required Redis client contract and does not introduce a generic client abstraction or alternate adapter.
- [x] The minimum plural `cacheHandlers` contract needed by the reference application stores and retrieves Cache Components entries through Redis.
- [x] The reference application integrates the package through public entry points, documents required configuration and environment inputs, and keeps deterministic commit/reset controls in the content service or test harness.
- [x] The demonstrated cached read accepts validated public content dimensions, reads only the published public projection, and does not depend on visitor cookies, authorization, preview state, IP data, or mutable request-global clients.
- [x] A cold production request returns the expected source revision and increments the source-read count.
- [x] A subsequent warm request returns the same revision without another source read.
- [x] Test runs use unique namespaces and never flush or interfere with a shared Redis database.
- [x] Fastify, Vitest, Testcontainers, and ESM are retained unless an executable incompatibility is demonstrated and the smallest viable fallback is documented.

## Comments

- 2026-09-16: The Fastify support service now exposes a published document read plus deterministic
  commit, read-count, and reset controls. Request schemas validate the public `site`, `locale`, and
  `slug` dimensions, and the service's focused HTTP tests pass independently of Redis.
- 2026-09-16: `unicorn-nextjs-memory-cache` now depends directly on `ioredis` `6.0.0` and exposes
  `createRedisCacheHandler(client: Redis, ...)` without an intermediate client abstraction. Its
  public `next-handler` entry implements the minimum plural Cache Components handler contract. A
  package integration test stores and reconstructs a streamed cache entry through an isolated
  `redis:8.2.1-alpine` Testcontainer.
- 2026-09-16: The reference app registers the public `next-handler` entry as its `remote`
  `cacheHandlers` implementation. The cached function uses `'use cache: remote'` only after
  validating public dimensions and reads the content service's published projection through Ky.
  The app README documents `REDIS_URL`, `REDIS_CACHE_NAMESPACE`, and `CONTENT_SERVICE_URL` plus the
  exact support-service controls and scenario limits.
- 2026-09-16: The production integration scenario generated a unique Redis namespace, reset the
  source to `revision-7`, started one built Next.js instance, and requested
  `/cache-demo/welcome` twice. The cold response contained `revision-7` with source reads equal to
  `1`; the warm response contained the same revision and the source count remained `1`. Neither
  integration test issues `FLUSHDB`, `FLUSHALL`, or deletes a shared namespace.
- 2026-09-16: Runtime verification used Next.js `16.3.5`'s `/_next/mcp` endpoint and
  `agent-browser` `0.37.1`. MCP reported no compilation, configuration, browser-session, or server
  errors. The browser rendered the stable shell and `revision-dev-1` published content with no
  console errors; two browser loads left the source count at `1`.
- 2026-09-16: Commits `cb630f7`, `ac10d49`, `5ea1ded`, and `6982640` contain the implementation,
  clean-checkout dependency ordering, ticket evidence, and review fixes. A detached worktree at
  `6982640` completed the frozen install and a cache-bypassed root `pnpm verify` on Node `24.21.0`,
  covering formatting, linting, type-checking, 10 tests, package builds, the production Next.js
  build, and both disposable Redis scenarios. Cross-instance reuse, invalidation, race handling,
  streaming bounds, and full freshness semantics remain scoped to later tickets.
