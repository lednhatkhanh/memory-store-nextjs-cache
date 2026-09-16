# Dependency policy

Every direct dependency is pinned exactly, either in its package manifest or through the exact
workspace catalog. `pnpm install --frozen-lockfile` is the reproducible install contract. Before a
dependency change, query the registry, check the package's engines and relevant peer requirements,
then run the affected package checks and `pnpm verify`.

## Review recorded 2026-09-16

| Direct dependency             | Accepted version | Compatibility evidence                                                                                                                                     |
| ----------------------------- | ---------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js / pnpm                | 24.21.0 / 12.4.2 | Exact engines, `.node-version`, Corepack package manager, and frozen install agree.                                                                        |
| Next.js                       |           16.3.5 | Current registry release; requires Node >=20.9 and accepts React 19.                                                                                       |
| React / React DOM / types     |           19.3.0 | Current releases; React DOM and its types require the matching React major/minor.                                                                          |
| React Aria Components         |           1.21.1 | Current release; peer ranges accept React and React DOM 19, with no package-level Node engine constraint.                                                  |
| TypeScript                    |            7.0.2 | Current release; compatible with Oxlint's TypeScript-Go type-aware engine.                                                                                 |
| `@types/node`                 |          24.13.5 | Latest major-24 release. Deliberately differs from the registry's major-22 default tag so types match the required Node 24 runtime.                        |
| Turborepo                     |          2.10.13 | Current registry release; exercised by every workspace verification task.                                                                                  |
| Vite / Vitest                 |    8.3.0 / 5.0.1 | Current releases; Vitest's Vite peer range and both packages' Node ranges include the pinned toolchain.                                                    |
| Oxlint / Oxfmt                |  1.83.0 / 0.68.0 | Current releases; both support Node 24.                                                                                                                    |
| `oxlint-tsgolint`             |         7.0.2001 | Current release paired with TypeScript 7 type-aware linting.                                                                                               |
| Rspack core / CLI             |            2.2.5 | Current matching releases; CLI's core peer range accepts 2.2.5.                                                                                            |
| Ky                            |            2.1.0 | Current release; requires Node >=22, satisfied by Node 24.                                                                                                 |
| Fastify                       |           5.12.4 | Current release; public HTTP injection test passes on Node 24.                                                                                             |
| Tailwind CSS / PostCSS plugin |    4.3.3 / 4.3.3 | Current matching releases; configured through the pinned Next.js PostCSS integration and exercised by its production build.                                |
| React Markdown                |           10.1.0 | Current release; React peer range includes React 19, and raw embedded HTML remains disabled.                                                               |
| date-fns                      |            4.4.0 | Current release; ESM with no Node engine or peer constraints; its direct conversion helper preserves fractional epoch precision.                           |
| es-toolkit                    |           1.52.0 | Current release; ESM with no Node engine or peer constraints; `uniq` preserves stable `Set` semantics, and `isPlainObject` validates record-shaped inputs. |
| ioredis                       |            6.0.0 | Current release; requires Node >=20 and is exercised against the pinned Redis container through the package's public handler API.                          |
| Testcontainers                |           12.1.0 | Current release; requires Node >=22.22 and starts and removes the isolated Redis containers used by both integration scenarios.                            |

The installed Next.js 16.3.5 docs are the compatibility source for React compilation. They state
that `experimental.turbopackRustReactCompiler` requires `reactCompiler`, works only with Turbopack,
and removes the need for `babel-plugin-react-compiler`; the Babel dependency is therefore absent.

Reproduce the registry review with `npm view <package> version engines peerDependencies --json`,
using `npm view @types/node@24 version --json` for the intentional Node-types exception. Executable
compatibility evidence is the focused package checks plus the clean-checkout `pnpm verify` result
recorded in the issue.
