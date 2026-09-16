# Agent-readiness audit

Recorded 2026-09-16 on Apple silicon with Node.js 24.21.0 and pnpm 12.4.2.

## Focused loop

| Check                                                                          | Observed time |
| ------------------------------------------------------------------------------ | ------------: |
| Cache package Oxlint, including type-aware, performance, and restriction rules |        258 ms |
| Cache package Vitest file                                                      |         67 ms |
| Rspack production compilation                                                  |         46 ms |
| All workspace lint tasks in Turborepo                                          |        459 ms |

The cache package's edit loop stays sub-second for each focused check. Full `pnpm verify` completed
in 7.92 seconds with cold local Turborepo tasks. It covered the package contract, formatting, strict
lint, type checks, four unit tests, the Fastify HTTP check, the 65-byte Rspack ESM bundle and types,
and the Next.js production build.

The final isolated local clone completed `pnpm install --frozen-lockfile` in 0.78 seconds and an
uncached `pnpm verify` in 25.40 seconds. All Turborepo tasks were cache misses, and verification left
the clone's worktree clean.

## Runtime evidence

From the final isolated clone, Next.js 16.3.5 started with Turbopack on port 3000 and reported the
native `turbopackRustReactCompiler` experiment. Its MCP endpoint listed `/`, returned no compilation
issues, compiled `/` on demand, and returned no config or browser-session errors. Agent Browser
0.37.1 rendered the expected `Workspace ready` output; its console contained only the development
HMR connection. The runtime commands left the clone clean, and the development server and browser
were closed after verification.

## Audit result

- Package metadata, exports, tests, docs, lockfile, and generated bundle use
  `unicorn-nextjs-memory-cache`; the executable package-contract check rejects the obsolete identity.
- Direct dependencies and toolchain versions are exact and reviewed in `dependency-policy.md`.
- Agent instructions point to version-matched docs and workflow skills instead of copying framework
  reference material.
- Lint exceptions are narrow and justified in `lint-policy.md`; there is no obsolete aggregate React
  Compiler lint rule.
- Formatting, lint contracts, type generation, tests, Rspack, and Next.js builds leave no generated
  untracked files in the repository.
- No CI/CD, deployment, or release automation was added.

The issue comment records the final frozen install and verification from a clean checkout.
