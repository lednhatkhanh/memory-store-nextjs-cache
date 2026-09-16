# unicorn-nextjs-memory-cache

An ESM-only Turborepo for developing a Redis-backed Next.js Cache Components handler, its canonical
Next.js reference application, and production-shaped support services.

## Workspace roles

- `packages/cache` is the publishable cache-handler library.
- `apps/web` is both the canonical, best-practice Next.js integration and the executable integration
  fixture for the library. Its application code is durable consumer guidance and the recommended
  starting point for adopters. Read `apps/web/README.md` before changing its Next.js configuration,
  routes, or cache integration.
- `apps/content-service` publishes checked-in Markdown as controllable upstream content for
  integration scenarios. See `apps/content-service/README.md` for its file convention.

## Prerequisites

- `fnm`
- Corepack
- A Docker-compatible container runtime for the Redis integration tests

Activate the pinned Node.js release and install the exact pnpm workspace:

```sh
fnm use
corepack pnpm install --frozen-lockfile
```

## Commands

- `pnpm build` builds every package and application.
- `pnpm --filter unicorn-nextjs-memory-cache build` creates the production ESM library bundle with
  Rspack and emits its TypeScript declarations.
- `pnpm check-types` runs strict TypeScript checks.
- `pnpm test` production-builds the Next.js fixture and runs the Vitest suites, including the
  isolated Redis Testcontainers scenarios.
- `pnpm lint` runs Oxlint.
- `pnpm format:check` verifies Oxfmt formatting.
- `pnpm measure:cache-resources` rebuilds the production cache package without a Turborepo cache
  lookup, runs its fixed workload in an isolated child and disposable Redis container, and prints
  structured resource evidence. See `packages/cache/README.md` for the workload and metrics.
- `pnpm verify` runs the complete local quality gate.
- `pnpm --filter @memory-store/web dev` starts the Next.js reference application.
- `pnpm --filter @memory-store/content-service dev` starts the Fastify support service.

See `docs/agent-workflow.md` for runtime and browser verification.
