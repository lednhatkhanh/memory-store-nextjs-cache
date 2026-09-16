# 14: Verify standalone builds and build/runtime revisions

**What to build:** Prove that the package works in the standalone deployment artifact produced by the Next.js reference application and that build-time content cannot silently defeat runtime invalidation.

**Blocked by:** 05: Invalidate committed content across instances; 11: Isolate environments, releases, sites, and locales.

**Status:** ready-for-agent

- [ ] The Next.js reference application produces and boots its standalone production output using the pinned Node.js 24 runtime.
- [ ] Standalone output uses the canonical application configuration rather than a test-only build variant, and deployment requirements are documented for consumers.
- [ ] The production build or startup fails when deployment/release identity is missing, copies the required `public` and `.next/static` assets, and uses a fleet-stable Server Actions encryption key when Server Actions are part of the verified scenario.
- [ ] Two processes started from the standalone artifact share Redis and pass the core cross-instance invalidation scenario.
- [ ] The test controls which revision exists during build and which revision exists at runtime.
- [ ] Content or artifacts created during build cannot restore an invalidated revision after a newer runtime publication.
- [ ] Relevant generated output and runtime requests are inventoried so each verified cache layer is named explicitly.
- [ ] The result documents unshared or unverified Next.js cache layers rather than assuming the plural custom handler owns all caching.
- [ ] Release namespaces behave correctly when two standalone releases serve traffic during a rollout.
- [ ] Rollout evidence covers an old browser against a new release and retains the old assets or action-serving capacity required during the drain window.
