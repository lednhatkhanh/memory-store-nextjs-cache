# 20: Publish Markdown content with a Tailwind reference UI

**What to build:** Make the Fastify content service load a simple checked-in Markdown collection,
render that Markdown in the Next.js reference application, and style the application with Tailwind
CSS backed by CSS variables and Oxfmt class sorting.

**Status:** resolved

- [x] Content files use `content/<site>/<locale>/<slug>.md`, with a first H1 title and a derived,
      deterministic revision.
- [x] Existing deterministic commit, reset, and read-count test controls remain available.
- [x] The Next.js application renders Markdown without enabling embedded raw HTML.
- [x] Tailwind CSS v4 uses the pinned Next.js PostCSS setup and CSS-variable design tokens.
- [x] Interactive controls and rendered Markdown links use React Aria Components, with locale
      context matching the document language and Next.js links retaining soft navigation.
- [x] Oxfmt sorts Tailwind classes against the application stylesheet.
- [x] Agent guidance directs Fastify extensions to the official ecosystem and prefers official
      plugins.

## Comments

- 2026-09-16: The implementation deliberately uses Node's file APIs rather than a Fastify plugin;
  loading a local content repository is application domain logic, not missing server capacity.
  Future Fastify extensions must begin with the official ecosystem catalog and prefer official
  plugins.
- 2026-09-16: Runtime verification used Next.js 16.3.5's `/_next/mcp` endpoint and
  `agent-browser` 0.37.1. Both sample Markdown pages rendered with their derived revisions, MCP
  reported no compilation, configuration, session, or runtime errors, browser diagnostics were
  empty, and the WCAG A/AA audit reported zero violations.
- 2026-09-16: A fresh temporary clone completed the frozen install and the full `pnpm verify`
  gate, covering Oxfmt's stylesheet-aware Tailwind sorting, lint, type checks, 11 tests, package
  builds, both disposable Redis scenarios, and the partial-prerendered production application.
- 2026-09-16: The reference UI now uses React Aria Components 1.21.1 for links and buttons. The
  local link primitive delegates its rendered anchor to `next/link`, preserving framework
  prefetching and soft navigation while exposing React Aria interaction and focus states.
- 2026-09-16: Verification covered the full `pnpm verify` gate and a live Next.js development
  session. React Aria hover state appeared on links and the retry button, navigation issued the
  expected RSC request, both Markdown routes rendered through Redis, MCP reported no compilation or
  runtime issues, browser diagnostics were clean after a normal reload, and the WCAG A/AA audit
  reported zero violations.
