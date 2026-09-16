# 02: Adopt Cache Components and Partial Prefetching

**What to build:** Establish the behavior that the Next.js reference application and cache package must support together. Adopt Cache Components first and Partial Prefetching second, leaving a production-buildable application with observable instant-navigation behavior at both checkpoints.

**Blocked by:** 01: Establish an agent-ready ESM Turborepo workspace.

**Status:** resolved

- [x] Cache Components is enabled and verified before Partial Prefetching is introduced.
- [x] The application uses the current supported Cache Components conventions and contains no incompatible legacy route-segment configuration.
- [x] Partial Prefetching is enabled only after the Cache Components checkpoint passes.
- [x] A representative route demonstrates a stable shell, dynamic content, a loading boundary, and prefetch behavior that can be inspected in the running application.
- [x] Both adoption checkpoints pass type-checking and a production build with the exact pinned Next.js release.
- [x] Agent-driven verification reads the bundled documentation for the installed Next.js version and checks the running route, development indicator, browser errors, and server errors.
- [x] The resulting behavior and known limitations are recorded without claiming that every generated or runtime Next.js cache layer is shared.

## Comments

- 2026-09-16: Cache Components was adopted and verified first in commit `6f90041`. With
  `partialPrefetching` still absent, `pnpm --filter @memory-store/web check-types` and
  `pnpm --filter @memory-store/web build` passed on Next.js `16.3.5`. The build classified
  `/cache-demo/[slug]` as a Partial Prerender. The development MCP compiled the route without
  issues, a request to `/cache-demo/alpha` returned HTTP 200 with the stable shell, Suspense
  fallback, and fresh alpha content, and the server log contained no application errors.
- 2026-09-16: Partial Prefetching was enabled separately in commit `04eae5c`, after the first
  checkpoint passed. The same type-check and production build passed with Next.js explicitly
  reporting both Cache Components and Partial Prefetching enabled. The production browser HAR
  showed successful `next-router-prefetch: 1` requests for both visible demo links. Both requested
  the `/_tree` segment with the same RSC identifier and response size; navigation then requested
  the beta URL-specific RSC content and rendered fresh beta data.
- 2026-09-16: Runtime verification used the documentation bundled with Next.js `16.3.5`, the
  `/_next/mcp` development bridge, and `agent-browser` `0.37.1`. The browser exposed the Next.js
  development-tools indicator, rendered the stable shell and fresh dynamic content, reported no
  console errors, and identified one request-bound Suspense hole. MCP reported no compilation,
  configuration, browser-session, or server errors and identified `loading.tsx` as the route's
  loading boundary. A detached clean worktree completed the frozen install and root `pnpm verify`,
  covering formatting, linting, type-checking, all tests, and all production builds.
- 2026-09-16: This checkpoint establishes only the application contract: a prerendered App Shell,
  streamed request-time content, a loading boundary, and client Partial Prefetching. It does not
  install a custom cache handler or Redis, does not demonstrate cross-process reuse, and does not
  claim that build artifacts, request memoization, the Data Cache, the Full Route Cache, or the
  browser's session-local Router Cache are one shared cache layer. Those remain separate concerns
  for later tickets.
- 2026-09-16: `apps/web` is the canonical consumer reference and the executable integration fixture.
  Keeping those roles in one application ensures later cache-handler tests exercise the exact
  configuration and routes recommended to adopters. A separate test application is warranted only
  when a scenario would otherwise make the canonical integration misleading or unsafe.
