# Lint policy

Oxlint and Oxfmt are the only default linting and formatting tools. The root Oxlint configuration
enables correctness, suspicious, import-boundary, React Compiler, and type-aware TypeScript checks
for all production code, tests, and TypeScript configuration. The cache package additionally treats
the complete performance and restriction categories as errors because published library code needs
the narrowest, most portable contract.

Barrel-only modules are errors, and object shapes use `type` aliases instead of TypeScript
`interface`. Named exports are preferred for project-owned modules, but default exports are not
forbidden because Next.js and build-tool configuration conventions sometimes require them.

Six cache-package exceptions are explicit:

- Tests may import their sibling `src` directory through a relative parent path. This is the public
  source seam used during the red/green loop, before a production bundle exists.
- `rspack.config.ts` may default-export its configuration because that is Rspack's loader contract.
- `src/next-handler.ts` may read the documented cache environment variables and default-export its
  handler because those are Next.js's runtime configuration and cache-handler loader contracts.
  Its `console.info` and `console.warn` calls emit only the documented fixed-shape cache and
  connection diagnostics plus the bounded instance label, deliberately excluding cached content,
  credentials, namespaces, tags, and raw cache keys.
- The streamed-entry serialization loop awaits each read and any limit-triggered cancellation in
  sequence. Parallelizing either operation would violate Web Streams ordering or publish work before
  cancellation has settled, so the three local `no-await-in-loop` suppressions document that required
  control flow.
- The resource-measurement child uses sequential loops for repeatable garbage-collection samples,
  seeded reads, writes and invalidations, ordered warm-up, and separately settled measurement
  phases. The local `no-await-in-loop` suppressions preserve those comparison boundaries.
- The real-Redis package test and resource-measurement coordinator may set `DOCKER_HOST` when the
  active Docker context uses a non-default socket, allowing Testcontainers to use that
  already-selected local runtime.

Two application conventions are also explicit: React's automatic JSX runtime makes
`react-in-jsx-scope` obsolete, and Next.js requires the root layout to import its global stylesheet
for side effects.

The repository does not enable the full performance and restriction categories for applications.
Those sets reject required framework conventions such as Next.js default route exports, global CSS
imports, ESM top-level await, and environment access. High-signal rules from both sets remain enabled
globally: React Compiler's `no-deriving-state-in-effects` and `unsupported-syntax` checks.

The one-off package-contract and generated React-lint fixture scripts were removed after the
toolchain contract was established. Their durable checks now live in package manifests, Oxlint,
package tests, and the normal `pnpm verify` gate rather than a separate scripts-only TypeScript
project.
