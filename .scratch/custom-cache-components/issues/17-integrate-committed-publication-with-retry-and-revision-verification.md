# 17: Integrate committed publication with retry and revision verification

**What to build:** Connect the consuming content workflow to the cache package so only committed publications trigger invalidation and propagation is not reported as complete until the required revision can be verified.

**Blocked by:** 11: Isolate environments, releases, sites, and locales; 12: Degrade safely during Redis and source failures; 13: Recover safely from Redis restart or restored state.

**Status:** ready-for-agent

- [ ] Invalidation begins only after the source transaction commits and includes the explicit dependencies and partitioning inputs owned by the application.
- [ ] The content transaction records a durable publication event atomically with the change; an external worker processes only committed events through a private authenticated invalidation boundary.
- [ ] Retry behavior is bounded, idempotent, observable, and safe across process restarts.
- [ ] Successful propagation verifies the committed revision rather than treating an accepted invalidation call as proof that every serving release is fresh.
- [ ] Accepted, invalidated, and verified-live are distinct observable states; an HTTP acceptance response is not reported as completed propagation.
- [ ] Every compatible release still serving traffic receives invalidation through shared state or explicit fan-out.
- [ ] Failed required invalidation prevents the publication workflow from reporting successful propagation and leaves actionable retry state.
- [ ] Update, deletion, and repeated-publication scenarios preserve the newest committed revision.
- [ ] Dependency selection covers old and new slugs, negative lookups, locale-prefixed paths, lists, related content, navigation, metadata, and sitemap entries when the publication affects them.
- [ ] Package and application ownership boundaries remain explicit: the package supplies cache behavior, while the content integration owns commit ordering, durable events, dependency selection, and retry orchestration.
- [ ] The reference application or its consumer documentation demonstrates the handoff from a committed publication to invalidation and revision verification without embedding Payload-specific orchestration in the app.
- [ ] Payload transactions, route ownership, CDN purging, and other production-system decisions remain explicit external inputs rather than being guessed in the library or reference application.
