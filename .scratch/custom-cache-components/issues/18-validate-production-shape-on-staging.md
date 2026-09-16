# 18: Validate the production shape on staging

**What to build:** Run the reference application or its documented public pilot through the complete publication and caching path on staging to establish whether the local correctness evidence survives the actual Memorystore, GKE, ingress, rollout, and Cloudflare environment.

**Blocked by:** 16: Establish CI and release evidence; 17: Integrate committed publication with retry and revision verification.

**Status:** ready-for-agent

- [ ] The pilot uses the intended Memorystore topology and production-shaped `ioredis` connection, authentication, timeout, and reconnect settings.
- [ ] Multiple GKE pods demonstrate cross-pod cache reuse, immediate invalidation, stale-write rejection, and safe rolling deployment behavior.
- [ ] Managed failover or the closest approved staging exercise follows the documented failure and recovery policies with observable results.
- [ ] Ingress preserves required streaming behavior and does not introduce an unaccounted response cache.
- [ ] Every proxy hop disables response buffering where required and preserves RSC, prefetch, router-state, query, host, and protocol semantics.
- [ ] Cloudflare and application checks prove that `/one-ecom` and `/ecom`, including applicable aliases and transport paths, bypass shared response caching.
- [ ] Mutable HTML, RSC, private, and preview responses have no persistent browser or CDN storage at launch; only verified immutable assets or versioned public media are eligible for long-lived caching.
- [ ] A streamed response containing any private section is treated as private as a whole rather than edge-caching an apparently public shell.
- [ ] Authenticated, preview, site, locale, and release isolation match the application policy in the deployed environment.
- [ ] Results record exact deployed versions, topology, performance observations, known limitations, and any divergence from Docker-based tests.
- [ ] Evidence uses repeated real GETs and validates headers plus body identity across document, RSC, segment-prefetch, action, and error representations; a cache `MISS` or HEAD response alone is insufficient.
- [ ] Browser evidence covers a clean profile and a profile carrying legacy HTTP-cache state so earlier positive TTLs cannot hide stale behavior.
- [ ] Any pilot divergence from `apps/web` is documented, and reusable changes to the supported Next.js integration are reflected back into the reference application before production approval.
- [ ] Production adoption remains blocked until the staging evidence satisfies the correctness contract and identifies a suitable public pilot route.
