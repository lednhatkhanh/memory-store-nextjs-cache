# 16: Establish CI and release evidence

**What to build:** Turn the compatibility scenarios into repeatable release evidence so a package version or Next.js upgrade cannot be declared supported without passing the relevant correctness contract.

**Blocked by:** 06: Prevent stale writes across invalidation races; 08: Honor freshness, stale-while-revalidate, and hard expiration; 09: Support implicit route tags and path invalidation; 11: Isolate environments, releases, sites, and locales; 12: Degrade safely during Redis and source failures; 13: Recover safely from Redis restart or restored state; 14: Verify standalone builds and build/runtime revisions; 15: Preserve instant navigation and session isolation.

**Status:** ready-for-agent

- [ ] Pull-request validation runs Turborepo tasks for Oxfmt verification, Oxlint, TypeScript, Vitest model/unit tests, real-Redis integration, a production build of the reference application, and core cross-instance and race scenarios.
- [ ] Scheduled or release validation runs broader Playwright coverage, repeated concurrency tests, restart scenarios, and standalone rollout checks.
- [ ] Every parallel worker uses a unique content and Redis namespace and cannot flush or mutate another worker's state.
- [ ] Failures retain random seeds, service logs, process logs, revision ordering, and useful container diagnostics.
- [ ] The release record names exact Node.js, pnpm, Next.js, React, TypeScript, Redis image, `ioredis`, and test-tool versions plus known limitations.
- [ ] Redis traffic, latency, memory use, and representative load are measured before any process-local cache or additional consistency optimization is proposed.
- [ ] A Next.js upgrade must pass the full compatibility suite and re-check the bundled handler documentation before the supported version is widened.
- [ ] Release evidence identifies the exact `apps/web` integration that consumers should follow so documented best practice and tested configuration remain the same artifact.
- [ ] The release gate is based on evidence for the correctness contract rather than a coverage-percentage target.
