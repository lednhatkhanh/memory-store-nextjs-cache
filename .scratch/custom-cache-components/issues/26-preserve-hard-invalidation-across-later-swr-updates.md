# 26: Preserve hard invalidation across later SWR updates

**What to build:** Make tag-state transitions monotonic so a later stale-while-revalidate update cannot make an entry reusable after an immediate invalidation has already made it unusable.

**Blocked by:** 08: Honor freshness, stale-while-revalidate, and hard expiration.

**Status:** ready-for-agent

- [ ] The tag-state model distinguishes an already-effective hard invalidation fence from a future delayed-expiration deadline.
- [ ] A stale-while-revalidate update never moves an effective hard-expiration fence into the future or otherwise revives an older entry.
- [ ] A later immediate invalidation can still shorten an earlier delayed-expiration policy.
- [ ] Repeated and overlapping immediate, stale-only, and delayed-expiration updates preserve the strongest applicable freshness guarantee regardless of arrival order.
- [ ] Pure model tests cover every transition ordering at equal, earlier, and later timestamps.
- [ ] A real-Redis regression stores revision 1, expires it immediately, applies a later SWR update, and proves revision 1 remains unusable on every handler instance.
- [ ] The two-process Next.js scenario exercises the same transition through the public revalidation route and proves no invalidated revision returns.
- [ ] The handler documentation records the monotonic transition rules and their relationship to `getExpiration()` and stale-write fencing.

## Comments

- 2026-09-17: Review reproduction against Redis 8.2.1: storing an entry, calling
  `updateTags([tag], { expire: 0 })`, and reading produced the expected miss. A later
  `updateTags([tag], { expire: 60 })` made that same stored entry readable again with
  `revalidate: -1`. The later update overwrote the effective hard-expiration timestamp with a
  future deadline, violating the immediate-invalidation correctness contract.
