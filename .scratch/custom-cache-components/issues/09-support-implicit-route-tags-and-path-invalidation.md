# 09: Support implicit route tags and path invalidation

**What to build:** Make path revalidation in the Next.js reference application invalidate every relevant cached route dependency while leaving unrelated routes and content reusable.

**Blocked by:** 05: Invalidate committed content across instances.

**Status:** resolved

- [x] Cached page content, layout dependencies, and metadata expose the expected implicit route-tag behavior through the production reference application.
- [x] Revalidating a path through the normal Next.js API causes subsequent server requests through both instances to observe the current revision.
- [x] A Server Action-only behavior, where applicable to the pinned release, is exercised through an actual Server Action.
- [x] Unrelated routes and explicitly unrelated tags remain reusable after path invalidation.
- [x] Assertions include rendered output, metadata, and source-read counts rather than inspecting only Redis state.
- [x] Route coverage records which framework cache layers were demonstrated and avoids claiming untested layers are shared.
- [x] The route, layout, metadata, and revalidation pattern remains a copyable consumer example; deterministic source controls stay in support services or tests.

## Comments

- 2026-09-17: Added `/path-cache-demo/[slug]` as the production reference for implicit route tags.
  The page, dynamic metadata, and segment layout use three independently observable remote-cache
  keys for the same validated public document. A progressively enhanced React Aria form invokes the
  real `revalidatePathCacheDemo` Server Action, which validates the slug before calling
  `revalidatePath()` with the literal route.
- 2026-09-17: The two-process production integration warms target and bystander routes, commits new
  source revisions, submits the actual Server Action to instance A, and asserts current rendered
  page content, layout data, and `<title>` metadata through A and B. Exact source-read counts prove
  the target dependencies refresh and then become reusable while the unrelated route and its
  explicit published-document tag remain reusable without another source read.
- 2026-09-17: Evidence covers the Cache Components entries consumed by the page,
  `generateMetadata`, and `[slug]` layout, plus the pinned Next.js 16.3.5 Server Action immediate
  response behavior. It does not claim Redis sharing for the Full Route Cache, request memoization,
  browser Router Cache, CDN caches, source replicas, or other framework and delivery caches.
- 2026-09-17: Bundled Next.js documentation confirmed the soft-tag handler contract. Live
  verification used `/_next/mcp` and `agent-browser` 0.37.1: the route compiled without issues, the
  browser rendered all dependencies and submitted the action without application errors, MCP
  resolved the action ID to its source export, and React diagnostics showed the intended Suspense
  boundaries. The clean detached-worktree gate passed frozen installation and root `pnpm verify`.
