# 01: Establish an agent-ready ESM Turborepo workspace

**What to build:** Create the executable workspace baseline for the cache library, its Next.js reference application, and its Node.js support services. Contributors and coding agents should be able to install, verify, build, and run the workspace with one consistent, version-pinned toolchain.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The workspace requires Node.js 24 and pnpm 12, records exact patch/tool versions, and produces a committed lockfile with exact resolved versions for the current Next.js, React, TypeScript, Turborepo, and supporting toolchain releases.
- [x] Turborepo exposes working build, type-check, unit-test, lint, and formatting-verification tasks with correct package dependencies and cache inputs.
- [x] Workspace packages are ESM-only. Any unavoidable CommonJS compatibility shim is minimal and accompanied by evidence explaining why it is required.
- [x] Oxlint and Oxfmt are the only default linting and formatting tools, and their checks pass from a clean checkout.
- [x] Vitest runs a representative smoke test, and Fastify is selected for Node.js HTTP services unless an executable compatibility check demonstrates a blocker and records the fallback.
- [x] A focused Next.js reference application builds for production with React Compiler enabled and exposes a page that can be verified in a running development server.
- [x] Each Next.js application has effective AI-agent instructions that point to its installed, version-matched documentation and coexist with the repository's existing agent-skill instructions.
- [x] The documented agent workflow includes runtime visibility into the development server, browser behavior, and server/client errors before work is declared complete.
- [x] Root and application documentation define `apps/web` as both the canonical consumer reference and the executable integration fixture, including the threshold for creating a separate scenario application.

## Comments

- 2026-09-16: Verified complete at `d924abe`. From a temporary clean worktree, Node.js
  `24.21.0` and pnpm `12.4.2` completed `pnpm install --frozen-lockfile` and `pnpm verify`.
  The verification covered Oxfmt, Oxlint, TypeScript, two Vitest smoke tests, package builds,
  and the Next.js `16.3.5` production build with React Compiler enabled. The development server
  also returned HTTP 200 for `/` with the expected reference application content and no server-side
  errors.
