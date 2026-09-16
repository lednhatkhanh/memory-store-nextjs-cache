# 04: Prove shared cache reuse across two instances

**What to build:** Demonstrate that two independent production processes of the Next.js reference application can reuse the same cached public content through Redis rather than relying on process-local state.

**Blocked by:** 03: Prove one-instance Redis cache reuse with ioredis.

**Status:** resolved

- [x] Two independently started processes of the reference application use separate `ioredis` clients, the same production build, the same content source, and the same isolated Redis namespace.
- [x] Warming content through instance A allows instance B to serve it without an additional source request.
- [x] Restarting either Next.js process does not remove or corrupt the shared cached entry.
- [x] No additional per-process content cache is introduced.
- [x] Diagnostics identify the serving instance and whether the request was a cache hit or miss without exposing content or raw cache keys.
- [x] The scenario is deterministic, leaves no child processes behind, and produces useful process logs when it fails.

## Comments

- 2026-09-16: The production integration scenario now starts two independent Next.js processes from
  one build with separate process-local ioredis clients, one content service, one unique Redis
  namespace, and one disposable `redis:8.2.1-alpine` container. Instance A reports a miss and reads
  `revision-7`; instance B reports a hit and leaves the source count at `1`. Replacements for A and B
  each report a hit after the original process exits, still with one source read.
- 2026-09-16: The default handler emits structured `cache`, `instance`, and `result` diagnostics.
  It does not log content, namespaces, or raw cache keys. The scenario preserves logs from every
  process run, searches joined stream output so chunk boundaries cannot hide an event, attaches logs
  to request and cleanup failures, and stops all tracked processes before support services.
- 2026-09-16: Next.js `16.3.5` runtime verification used `/_next/mcp` and `agent-browser` `0.37.1`.
  MCP found no compilation, configuration, or browser-session errors. Chrome rendered the checked-in
  Markdown revision, the React tree retained the intended Suspense boundary, the browser console had
  no errors, and the development log recorded both miss and hit diagnostics for `next-dev-loop`.
- 2026-09-16: The two-axis review found incomplete failure logging, chunk-sensitive diagnostic
  matching, duplicated restart logic, and the unresolved ticket state. Commits `609b7fc` and
  `9448f8d` contain the implementation and review fixes. A fresh detached worktree completed a
  frozen install and cache-bypassed root `pnpm verify`, covering formatting, linting, type-checking,
  11 tests, package builds, the production Next.js build, and all disposable Redis scenarios.
