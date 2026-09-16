## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.

### Next.js reference application

For changes to `apps/web`, Next.js cache integration, consumer examples, or integration scenarios,
read `apps/web/README.md`. It defines the application's dual reference-and-verification contract.

## Engineering contract

- Read the installed, version-matched documentation before changing a framework or tool. Next.js
  work starts in `apps/web/node_modules/next/dist/docs/`; other library lookups follow the Context7
  rule above.
- Keep workspace code ESM-only and strictly typed. Test behavior through exported APIs, HTTP routes,
  rendered UI, or another public seam.
- Import from the module that owns a symbol; do not create barrel-only re-export files. Prefer
  `type` aliases over TypeScript `interface`, and prefer named exports. Default exports remain
  acceptable when a framework or tool contract expects them.
- Pin every direct dependency exactly. Read `docs/dependency-policy.md` before adding or upgrading
  one, and update its review evidence with the lockfile.
- Use Ky for application-owned HTTP requests. Keep native Next.js request APIs where substitution
  would change caching, streaming, revalidation, or request semantics.
- Before writing utility logic, check whether `es-toolkit` provides the required behavior and use
  its function when it does. Prefer named imports from `es-toolkit`; add the exact-pinned dependency
  only to the owning package and follow the dependency policy when introducing it.
- Keep changes narrow. Preserve generated files that the owning tool expects, and regenerate
  committed metadata rather than editing it by hand.
- Treat lint suppressions as reviewed exceptions: scope them to the narrowest file or rule and
  record the reason in `docs/lint-policy.md`.
- During iteration, run the affected package's type check and focused test. Before completion, use
  the clean-checkout gate in `docs/agent-workflow.md`.
- For a running Next.js edit/verify loop, use `.agents/skills/next-dev-loop/SKILL.md`. For Rspack
  configuration or profiling, use `.agents/skills/rspack-best-practices/SKILL.md`.
- For Node.js runtime work, use `.agents/skills/node/SKILL.md`. For the Fastify content service,
  use `.agents/skills/fastify-best-practices/SKILL.md`.
- Before extending Fastify with a custom integration or dependency, search the official
  [Fastify ecosystem](https://fastify.dev/ecosystem/). Prefer Fastify core, then an official plugin
  maintained by the Fastify team; use a community plugin only when no official option fits and
  document its maintenance and compatibility rationale in `docs/dependency-policy.md`.
