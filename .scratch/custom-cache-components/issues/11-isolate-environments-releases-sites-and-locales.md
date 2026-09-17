# 11: Isolate environments, releases, sites, and locales

**What to build:** Prevent incompatible deployments and application dimensions from reading one another's cached data while preserving intentional invalidation across every release still serving traffic.

**Blocked by:** 05: Invalidate committed content across instances.

**Status:** resolved

- [x] The namespace contract partitions incompatible environments and releases and includes the application-provided site and locale inputs required by the reference application.
- [x] Identical content identifiers in different environments, sites, or locales cannot collide or leak values.
- [x] Compatible processes in one deployment can share entries and invalidation state intentionally.
- [x] A rolling-deployment scenario demonstrates either a shared compatible invalidation mechanism or explicit fan-out to every serving release.
- [x] An incompatible release cannot interpret an entry written with a different serialization or behavior version.
- [x] Namespace construction is deterministic, validated, and covered by model tests without placing credentials or private content in keys.
- [x] The public contract makes application-owned partitioning inputs explicit rather than attempting to infer authorization or tenancy from opaque cache entries.
- [x] The reference application documents where its site, locale, environment, and release inputs originate and validates them at the application boundary.
- [x] Shared public-cache arguments and tags include every content dimension they depend on; credentials, raw visitor identifiers, and private content are absent from cache keys and tags.

## Comments

- 2026-09-17: `createCacheNamespace()` now requires explicit application, environment, site,
  locale, and release inputs. It validates their public identifier shapes and derives deterministic
  SHA-256 deployment and release identifiers, so the original values never appear in Redis keys.
- 2026-09-17: Entry, entry-generation, and pending-render keys are release-scoped. Tag metadata,
  metadata generation, and safety floors remain deployment-scoped and in the same Redis Cluster
  slot. Compatible processes therefore share entries, while incompatible releases cannot decode
  one another's entries and still observe one durable invalidation stream during a rollout.
- 2026-09-17: Package and production Next.js scenarios prove release isolation and shared
  invalidation. Two releases independently warm the same content identifier; invalidation through
  release 2 makes revision 1 unavailable through both releases before each publishes revision 2.
- 2026-09-17: The reference application validates `REDIS_CACHE_NAMESPACE`,
  `REDIS_CACHE_ENVIRONMENT`, `REDIS_CACHE_RELEASE`, `REDIS_CACHE_SITE`, and
  `REDIS_CACHE_LOCALE` at its environment boundary. Site and locale are passed into every shared
  cached content call and tag alongside slug and cache role; request credentials and visitor state
  remain outside the cached scope.
- 2026-09-17: Live Next.js 16.3.5 verification used `/_next/mcp` and `agent-browser` 0.37.1.
  Compilation and runtime diagnostics were empty, the browser rendered the configured
  `reference/en/welcome` document, and React diagnostics retained the expected dynamic Cache
  Components boundary.
- 2026-09-17: A fresh temporary clone completed `corepack pnpm install --frozen-lockfile` and the
  cache-bypassed root `pnpm verify`, covering formatting, linting, type-checking, 84 tests, package
  builds, the production Next.js build, and all disposable Redis scenarios.
