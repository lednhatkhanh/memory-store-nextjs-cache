# 10: Prevent metadata loss from reviving obsolete entries

**What to build:** Define and enforce metadata lifetime rules so deleting, expiring, or losing tag state can never cause an obsolete surviving cache entry to become valid again.

**Blocked by:** 06: Prevent stale writes across invalidation races; 08: Honor freshness, stale-while-revalidate, and hard expiration.

**Status:** ready-for-agent

- [ ] The relationship among entry lifetime, tag-metadata lifetime, cleanup, and memory bounds is documented as one coherent policy.
- [ ] Missing tag metadata follows a fail-safe rule and never makes an existing entry appear newer or valid by default.
- [ ] Expiring or evicting tag metadata while associated entries remain cannot revive content invalidated earlier.
- [ ] Cleanup bounds metadata growth without deleting state that surviving entries still require for correctness.
- [ ] Model tests explore lifetime and invalidation orderings, including metadata disappearance between a read and write.
- [ ] Real-Redis integration tests reproduce metadata loss and prove subsequent requests cannot reuse obsolete content.
- [ ] Operational diagnostics distinguish an ordinary cache miss from a safety miss caused by absent or incompatible metadata.
