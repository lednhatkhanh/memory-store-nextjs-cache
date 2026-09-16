# Agent development workflow

## Toolchain

Use the exact versions recorded by the repository:

```sh
fnm use
corepack pnpm install --frozen-lockfile
```

Node.js is pinned in `.node-version`; pnpm is pinned by the root `packageManager` field. Workspace
dependency versions and integrity hashes are committed in `pnpm-lock.yaml`.

## Static and test verification

During development, run the affected package's type check and single Vitest file after each small
change. Before completion, run the root `pnpm verify` command. It checks formatting, linting,
types, unit tests, package contracts, and production builds through Turborepo. Run it once from a
fresh temporary clone or worktree after `corepack pnpm install --frozen-lockfile` so untracked build
state cannot hide a missing input.

Oxlint and Oxfmt are the repository's only default linting and formatting tools. Do not add another
linter or formatter without an explicit repository decision.

## Runtime visibility

Start the Next.js reference application with `pnpm --filter @memory-store/web dev`. It also serves
as the library's executable integration fixture. If `.next/dev/lock` already exists, connect to the
recorded server instead of starting a duplicate. Keep its terminal visible and use the installed
`next-dev-loop` skill to inspect `/_next/mcp`, compile the route, open it through `agent-browser`,
read rendered output, and check browser/React diagnostics. The committed `.mcp.json` pins the
Next.js development-tools bridge; `logging.browserToTerminal` also forwards browser output to the
server terminal.

If the optional MCP bridge or browser CLI is unavailable, let `next-dev-loop` refuse its full
workflow and exit that skill as required. Then use the public route plus the development log as this
repository's limited fallback; do not claim browser-console or React-tree coverage. Record which
integration is missing and capture the route, response, server log, and limitation so another
contributor can reproduce and finish the runtime check.

The Fastify support service runs with `pnpm --filter @memory-store/content-service dev`; its public
readiness seam is `GET /health` on port 3100 by default.

There is intentionally no CI/CD setup in this baseline. Automation and release evidence are a
separate project task.
