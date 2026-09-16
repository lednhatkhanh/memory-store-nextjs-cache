# 19: Harden the agent-ready Rust toolchain and package contract

**What to build:** Turn the workspace baseline into a fast, strict, and self-explanatory environment for agents and contributors: publish the cache library under its intended identity, use compatible current dependencies, prefer Rust-backed React compilation and validation, standardize application-owned HTTP calls, and make the repository's operating rules and runtime feedback sufficient for an agent to work accurately without slowing iteration.

**Blocked by:** 01: Establish an agent-ready ESM Turborepo workspace.

**Status:** resolved

- [x] The cache library's package identity is `unicorn-nextjs-memory-cache`, and workspace references, documentation, tests, generated metadata, and the lockfile contain no obsolete package identity.
- [x] Every direct dependency in every workspace package is reviewed against the current registry and its relevant upstream compatibility requirements; accepted versions are pinned exactly, Node.js types remain on major 24, and any deliberate exception to the newest release is documented with executable compatibility evidence.
- [x] Ky is the preferred client for application-owned HTTP requests and is exercised through a representative typed request and failure path; native framework APIs remain in use where replacing them would alter Next.js caching, streaming, revalidation, or request semantics.
- [x] Oxlint enables the React plugin and its React Compiler-powered correctness rules for React code, removes obsolete compiler lint rules if present, and demonstrates that a representative Rules of React violation fails linting as described by the current Oxc guidance: https://oxc.rs/blog/2026-08-18-react-compiler-support.
- [x] Linting is materially stricter for the cache library than the initial baseline, including appropriate correctness, suspicious, performance, restriction, and type-aware checks supported by the pinned Oxlint release; noisy or incompatible rules are explicitly justified rather than silently disabled.
- [x] The strict lint policy covers production code, tests, configuration, and package boundaries without introducing ESLint, Prettier, or another default linter or formatter, and focused linting remains fast enough for the edit-and-verify loop.
- [x] The Next.js reference application uses the native Turbopack Rust React Compiler together with React Compiler support, removes the Babel compiler dependency when the pinned Next.js contract no longer requires it, and passes both development compilation and a production build.
- [x] Root and application agent instructions define an initial, enforceable operating contract covering bundled version-matched documentation, ESM-only code, public-interface test seams, strict typing, dependency policy, HTTP-client policy, narrow changes, generated files, suppressions, focused checks during iteration, and the full completion gate.
- [x] Root and application guidance defines `apps/web` as the canonical best-practice reference and executable integration fixture, with test controls separated from consumer-facing paths and a clear threshold for adding a scenario-specific app.
- [x] The Next.js application follows the current AI-agent setup guidance at https://nextjs.org/docs/app/guides/ai-agents: its managed instructions are preserved, browser diagnostics reach the terminal, agents can inspect the running development server, and duplicate development servers are avoided.
- [x] The relevant version-compatible Next.js workflow skills are evaluated and installed where they improve this project's recurring work, including a runtime edit-and-verify loop; installed skills and their intended triggers are discoverable without duplicating framework documentation into agent instructions.
- [x] Runtime verification exposes rendered output, browser console diagnostics, server logs, compilation issues, and route compilation through agent-readable tools, with a documented fallback when a browser or optional runtime integration is unavailable.
- [x] A final agent-readiness audit removes redundant instructions and avoidable slow checks, confirms generated commands leave a clean worktree, and records focused-check and full-verification timings so stricter rules do not accidentally make normal iteration impractical.
- [x] From a clean checkout, exact installation, formatting verification, strict linting, type-checking, unit tests, the Fastify service check, Next.js runtime verification, and the production build all pass with the pinned toolchain.
- [x] No CI/CD workflow, deployment automation, or release pipeline is introduced by this ticket.

## Comments

- 2026-09-16: Implemented in `1c0c475` with review fixes in `9b53254`. The cache package now
  publishes as `unicorn-nextjs-memory-cache` and builds a production `modern-module` ESM bundle with
  Rspack 2.2.5. The completed browser/MCP development check rendered `/`, reported no compilation or
  runtime errors, and exposed server logs plus route compilation. From an isolated clone at
  `9b53254`, Node.js 24.21.0 and pnpm 12.4.2 completed frozen installation in 0.78 seconds and an
  uncached `pnpm verify` in 25.40 seconds; the clone remained clean. The gate covered formatting,
  strict and type-aware Oxlint, four unit tests, Fastify HTTP injection, all TypeScript checks, the
  Rspack package build, and the Next.js Turbopack production build with the native Rust React
  Compiler. A second isolated clone at `c27eb4f` then passed the complete runtime check: MCP route
  discovery, proactive compilation, rendered browser output, browser console, server logs, and zero
  runtime/config errors; the clone remained clean. The two-axis review findings were fixed before
  resolution.
- 2026-09-16: Follow-up simplification removed the one-off package and React lint contract scripts
  and their dedicated TypeScript project. Oxlint now rejects barrel files and TypeScript interfaces,
  agent guidance prefers named exports while preserving framework/tool exceptions, and the project
  installs the `node` and `fastify-best-practices` skills from `mcollina/skills`. The simplified
  `pnpm verify` gate passes, including the production Rspack library bundle.
