# 11: Isolate environments, releases, sites, and locales

**What to build:** Prevent incompatible deployments and application dimensions from reading one another's cached data while preserving intentional invalidation across every release still serving traffic.

**Blocked by:** 05: Invalidate committed content across instances.

**Status:** ready-for-agent

- [ ] The namespace contract partitions incompatible environments and releases and includes the application-provided site and locale inputs required by the reference application.
- [ ] Identical content identifiers in different environments, sites, or locales cannot collide or leak values.
- [ ] Compatible processes in one deployment can share entries and invalidation state intentionally.
- [ ] A rolling-deployment scenario demonstrates either a shared compatible invalidation mechanism or explicit fan-out to every serving release.
- [ ] An incompatible release cannot interpret an entry written with a different serialization or behavior version.
- [ ] Namespace construction is deterministic, validated, and covered by model tests without placing credentials or private content in keys.
- [ ] The public contract makes application-owned partitioning inputs explicit rather than attempting to infer authorization or tenancy from opaque cache entries.
- [ ] The reference application documents where its site, locale, environment, and release inputs originate and validates them at the application boundary.
- [ ] Shared public-cache arguments and tags include every content dimension they depend on; credentials, raw visitor identifiers, and private content are absent from cache keys and tags.
