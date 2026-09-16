# 15: Preserve instant navigation and session isolation

**What to build:** Keep the Next.js reference application's Cache Components and Partial Prefetching navigation behavior while proving that public caching never leaks authenticated, preview, or user-specific content between browser sessions.

**Blocked by:** 09: Support implicit route tags and path invalidation; 14: Verify standalone builds and build/runtime revisions.

**Status:** ready-for-agent

- [ ] Playwright runs against the production-built reference application with independent contexts for anonymous users, authenticated user A, authenticated user B, and preview mode.
- [ ] Direct visits, soft navigation, partial prefetching, back/forward navigation, and streaming fallbacks behave as documented for the pinned Next.js release.
- [ ] React Aria navigation controls continue delegating to `next/link`; accessibility primitives
      must not replace Next.js prefetching, transition, or client-router behavior.
- [ ] Login and logout transitions cannot reuse another authentication state's private or draft content through the shared cache.
- [ ] Authentication and preview behavior use supported, production-appropriate Next.js boundaries in the reference application; test credentials and session seeding remain in the Playwright harness.
- [ ] Shared cached components and data functions cannot read visitor cookies, authorization, preview state, IP data, experiments, or authenticated request clients; visitor-specific reads remain request-time and independently authorized.
- [ ] Site, locale, public, authenticated, and preview inputs are partitioned according to the application's explicit policy.
- [ ] A prefetched revision may persist only for the accepted client-cache lifecycle; a new server request after successful immediate invalidation must satisfy the server freshness contract.
- [ ] Tests do not add forced reloads, publish-driven polling, or custom routing behavior to hide framework behavior.
- [ ] Login, logout, and account switching initially use a full navigation and clear visitor-specific client state, and no service worker stores authenticated API responses.
- [ ] Browser, server, and Next.js development diagnostics are captured on failure and are usable by coding agents following the repository instructions.
