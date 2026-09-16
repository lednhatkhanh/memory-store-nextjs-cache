# Next.js reference application instructions

The repository-level `AGENTS.md` remains authoritative and applies here.

Before changing configuration, routes, cache integration, or examples, read `README.md` in this
directory. Preserve both roles defined there: consumer-quality reference implementation and
executable integration fixture.

Before changing this application, read the documentation shipped with its installed and pinned
Next.js version under `node_modules/next/dist/docs/`. Start with
`node_modules/next/dist/docs/01-app/` and select the narrowest relevant page. Do not rely on global
or online documentation for a different Next.js version when the installed documentation answers
the question.

Use Ky for HTTP calls owned by this application, including calls to support services. Use Next.js
`fetch`, `NextRequest`, `NextResponse`, and revalidation APIs where their framework semantics are
part of the behavior. Keep the application ESM-only and test requests through exported clients or
public routes.

Use React Aria Components for interactive controls and accessible UI patterns. Before adding or
changing one, read the installed `.agents/skills/react-aria/SKILL.md` and the referenced component
documentation. Compose React Aria `Link` with `next/link` through its `render` prop so the reference
application retains Next.js prefetching and soft navigation. Prefer React Aria interaction events
and state attributes, such as `onPress`, `data-hovered`, and `data-focus-visible`, over duplicating
their behavior with native event handlers.

Before declaring application work complete:

1. Run `pnpm --filter @memory-store/web check-types` and `pnpm --filter @memory-store/web build`.
2. When its preflight requirements are available, use the installed `next-dev-loop` skill against
   the existing development server; honor `.next/dev/lock` instead of starting a duplicate. If the
   skill refuses preflight, exit it and use the limited fallback in `docs/agent-workflow.md`.
3. Check the MCP compilation issues, browser console, rendered output, and development-server log.
4. Exercise the behavior through its public route rather than only inspecting generated files.

See `docs/agent-workflow.md` for the repository-wide runtime-verification workflow.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
