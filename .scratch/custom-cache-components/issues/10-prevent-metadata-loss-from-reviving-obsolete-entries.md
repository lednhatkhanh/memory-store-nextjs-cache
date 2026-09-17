# 10: Prevent metadata loss from reviving obsolete entries

**What to build:** Define and enforce metadata lifetime rules so deleting, expiring, or losing tag state can never cause an obsolete surviving cache entry to become valid again.

**Blocked by:** 06: Prevent stale writes across invalidation races; 08: Honor freshness, stale-while-revalidate, and hard expiration.

**Status:** resolved

- [x] The relationship among entry lifetime, tag-metadata lifetime, cleanup, and memory bounds is documented as one coherent policy.
- [x] Missing tag metadata follows a fail-safe rule and never makes an existing entry appear newer or valid by default.
- [x] Expiring or evicting tag metadata while associated entries remain cannot revive content invalidated earlier.
- [x] Cleanup bounds metadata growth without deleting state that surviving entries still require for correctness.
- [x] Model tests explore lifetime and invalidation orderings, including metadata disappearance between a read and write.
- [x] Real-Redis integration tests reproduce metadata loss and prove subsequent requests cannot reuse obsolete content.
- [x] Operational diagnostics distinguish an ordinary cache miss from a safety miss caused by absent or incompatible metadata.

## Comments

- 2026-09-17: Published explicit tags and observed implicit soft tags now use complete stale,
  expired, updated, and retained-until records. A namespace safety floor advances on invalidation
  and cleanup, and slot-local Lua operations reject publications at or before that floor when tag
  state is absent. Missing explicit state and partial state fail closed; missing soft state is
  neutral only when its prospective observation or entry timestamp proves it newer than the floor.
- 2026-09-17: `get()` gives soft tags on a miss a bounded 60-second prospective lease stored in
  Redis. Publication atomically includes those tags in fencing, extends their retention through
  the entry's hard lifetime, and clears the pending set. `refreshTags()` removes complete metadata
  only after the maximum associated lifetime and first advances the floor, bounding expired state
  without reviving older entries.
- 2026-09-17: Seeded lifetime-model tests cover reads, writes, invalidations, metadata loss, and
  completion order. Real Redis tests remove complete and partial metadata, reproduce disappearance
  between read and write, verify `getExpiration()` fails safe for implicit tags, and prove cleanup
  preserves state required by surviving explicit and implicit-tag entries.
- 2026-09-17: Ordinary request misses retain the existing `result: "miss"` log. Safety misses add a
  bounded warning identifying read versus write and absent versus incompatible metadata without
  content, namespaces, tags, or cache keys.
- 2026-09-17: Next.js 16.3.5 runtime verification used `/_next/mcp` and `agent-browser` 0.37.1.
  The public welcome route rendered the expected revision from a remote-cache hit, MCP reported no
  compilation or runtime errors, the browser console had no errors, and React retained the two
  documented dynamic Suspense holes. The root `pnpm verify` gate passed with 47 cache-package tests,
  six web tests including the two-instance Redis scenarios, all type/lint/format checks, and all
  production builds.
