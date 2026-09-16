# Next.js reference application

`apps/web` is the canonical, executable best-practice Next.js application for
`unicorn-nextjs-memory-cache`. It has two inseparable responsibilities:

1. **Reference implementation:** show adopters the supported, production-appropriate way to install,
   configure, and use the library with the pinned Next.js release.
2. **Integration fixture:** exercise that same integration through development, production builds,
   browser navigation, and multi-process cache scenarios.

The project intentionally keeps one application for both roles. This makes verification exercise
the exact integration consumers are expected to copy and prevents example and test configurations
from drifting apart.

“Best practice” here means a pattern verified against the pinned Next.js and library versions, with
its assumptions and limits recorded. It is concrete consumer guidance rather than a compatibility
claim for untested versions or deployment shapes.

## Application contract

- Integrate the library only through its public package entry points and documented Next.js
  configuration. Application routes must not reach into package internals.
- Use current conventions from the documentation bundled with the pinned Next.js release. Record
  version-specific behavior and limitations when they affect consumers.
- Keep examples production-appropriate: explicit configuration, meaningful loading and error
  states, accessible rendered output, and no hidden test-only shortcuts.
- Build interactive controls from React Aria Components. Keep application navigation on Next.js's
  `Link` through React Aria's `render` integration so accessibility behavior does not replace
  prefetching or client-side navigation. Match the server `lang` and `dir` attributes with the
  client `I18nProvider` locale.
- Style the reference UI with Tailwind CSS utilities and keep shared design tokens as CSS variables
  in `app/styles.css`. Oxfmt sorts utility classes against that stylesheet.
- Make cache behavior observable through public seams such as HTTP responses, rendered UI, source
  read counts, browser navigation, and supported Next.js diagnostics.
- Place scenario controls and fault injection in tests, support modules, or support services. Keep
  the application integration itself copyable.
- Keep the application focused. Add UI and routes when they teach a supported integration pattern
  or verify a library guarantee.

## Production boundaries

- Model one public App Router frontend capable of representing global and local route families.
  Payload administration, editorial authentication, durable publication events, and retry
  orchestration remain separate application concerns.
- Separate reusable public-content modules from visitor-data modules. Shared cached reads accept
  validated content dimensions such as site, locale, and slug; visitor cookies, authorization,
  preview state, IP data, and experiments stay in request-time code outside shared caches.
- Treat the content service as a controllable published-content source. Its commit, pause, reset,
  failure, and read-count controls are integration-test facilities rather than consumer APIs.
- Start mutable HTML, RSC, private, and preview responses with no persistent browser or CDN storage.
  Keep Next.js server caching independent from that response policy, and allow long-lived delivery
  only for verified hashed assets or versioned public media.
- Keep production deployment behavior reproducible: standalone output, explicit release identity,
  fleet-stable Server Actions configuration where applicable, complete static assets, and streaming
  preserved through every proxy hop.

## Feature completion

A library feature that affects Next.js integration is complete only when:

- this application demonstrates the intended consumer setup;
- focused tests or runtime checks exercise behavior through a public seam;
- the pinned production build succeeds; and
- the originating issue records what was verified and which Next.js cache layers or deployment
  shapes remain outside the evidence.

Use `docs/agent-workflow.md` from the repository root for the exact static, production-build, and
runtime verification loop.

## Redis Cache Components integration

The application registers the package's public `next-handler` subpath as the `remote` entry in
Next.js's plural `cacheHandlers` configuration. Published content is read through a function marked
with `'use cache: remote'`; request-time visitor state is not read or passed into that function.
Its cache dimensions are limited to the validated public `site`, `locale`, and `slug` values.

Set these environment variables when running the reference application:

| Variable                           | Default                     | Purpose                                                                    |
| ---------------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `REDIS_URL`                        | `redis://127.0.0.1:6379`    | ioredis connection URL used by the package's default Next.js handler.      |
| `REDIS_CACHE_NAMESPACE`            | `memory-store-nextjs-cache` | Prefix that isolates an environment's cache entries from other users.      |
| `REDIS_CACHE_MAX_ENTRY_SIZE_BYTES` | `8388608`                   | Maximum metadata plus raw streamed bytes accepted for one cache entry.     |
| `REDIS_CACHE_MAX_BUFFERED_BYTES`   | `33554432`                  | Maximum raw stream bytes buffered by one handler across concurrent writes. |
| `CONTENT_SERVICE_URL`              | `http://127.0.0.1:3100`     | Base URL for the published-content source used by the reference route.     |
| `CACHE_INSTANCE_ID`                | Current process ID          | Safe instance label included in cache hit/miss diagnostics.                |
| `REVALIDATION_SECRET`              | None                        | Bearer secret required by the publication revalidation webhook.            |

Production deployments should set an explicit, stable namespace for each environment. Tests always
generate a unique namespace and never flush Redis. The executable scenario uses Testcontainers with
the pinned `redis:8.2.1-alpine` image and starts two independent processes from one production build.
Instance A warms `/cache-demo/welcome`; instance B and restarted replacements for both processes reuse
the same Redis entry without another source read. Each process owns its own ioredis client. The handler
logs structured `cache`, `instance`, and `result` fields for each lookup, without content, namespaces,
or raw cache keys, so failures distinguish the serving process and a cache hit from a miss.

Each cached published document carries a tag derived from its validated site, locale, and slug.
The cached function calls `cacheLife("publishedContent")`, whose checked-in profile makes content
fresh on the server for one hour and hard-expires it after one day. During the fresh hour, either
application instance can reuse the shared Redis entry without reading the source. After one hour,
Next.js may serve the entry while regenerating it in the background; a successful regeneration
publishes a new timestamped revision that every instance can reuse. After one day, the handler and
Next.js treat the entry as a miss: neither fresh nor stale content is served, and a request must run
an allowed source render. The profile's five-minute `stale` value controls the Next.js client router,
not the server-side fresh-to-SWR boundary.

After publishing a document, an authorized system can send those dimensions as JSON to
`POST /api/revalidate/content` with `Authorization: Bearer <REVALIDATION_SECRET>`. The Route Handler
uses `revalidateTag(tag, { expire: 0 })`, the production-appropriate Next.js boundary for immediate
expiration from a webhook or other external system. The cache handler records tag staleness and
expiration timestamps in namespace-scoped Redis sorted sets. Every instance consults that durable
state when reading an entry, so correctness does not depend on Pub/Sub or process-local state.

Content whose documented policy permits a brief old response during refresh can explicitly add
`"policy": "stale-while-revalidate"` to the same authenticated request. That opt-in uses the
checked-in `briefStaleContentRefresh` profile: the next request may receive the old value while
Next.js refreshes it in the background, but the value becomes a hard miss after two seconds if no
refresh completes. This delayed-expiration form is supported by the pinned Next.js 16.3.5 plural
handler contract. Omit `policy` for publication events that require immediate removal; a prior SWR
deadline cannot weaken a later expire-now update.

The Fastify content service exposes the published projection at
`GET /documents/:site/:locale/:slug`. Deterministic integration controls live under `__test`: commit
with `PUT /__test/documents/:site/:locale/:slug`, inspect reads with
`GET /__test/read-count/:site/:locale/:slug`, and reset documents and counts with
`POST /__test/reset`. A selected source response can be held after it captures a document by arming
`PUT /__test/response-pauses/:pauseId`, waiting on
`GET /__test/response-pauses/:pauseId/reached`, and calling
`POST /__test/response-pauses/:pauseId/release`. These controls are support-service facilities, not
consumer application APIs.
During normal development, the service loads
`apps/content-service/content/<site>/<locale>/<slug>.md`. The first H1 becomes the title, the
remaining Markdown becomes the body, and the file contents determine its revision. The web
application renders Markdown without enabling embedded raw HTML.

Cache publication uses Next.js's cache-entry timestamp as a fencing value. Next.js 16.3.5 records
that epoch-millisecond timestamp when generation starts; tag invalidation records an epoch timestamp
from the same `performance.timeOrigin + performance.now()` clock shape. One Redis Lua operation
compares the candidate against every explicit tag timestamp and the currently stored entry, then
writes only when the candidate is strictly newer than both. Equality is rejected conservatively.
For a deferred hard-expiration profile, its future deadline becomes a fence only once that deadline
is reached; the immediate stale timestamp still rejects work that started before revalidation.
The entry and tag keys share a namespace-derived Redis hash tag, so the compare-and-set remains one
atomic operation on Redis Cluster as well as standalone Redis. This strategy assumes participating
Next.js hosts have synchronized epoch clocks, monotonic clocks within a process, and enough clock
resolution to strictly order generation starts and publication invalidations. Redis provides the
atomic ordering decision but does not supply the timestamps; clock skew that reverses those events
would violate the fence assumption.

The handler consumes a candidate value to completion before publication and bounds that work to
8 MiB of metadata plus raw payload per entry and 32 MiB of raw payload retained across concurrent
writes by default. The base64 and JSON encoding copies are therefore also bounded by the entry cap.
Both limits are configurable with the environment variables above. An over-limit stream is rejected
without changing the reusable entry; its fixed-shape warning records only the reason and byte counts,
not content, namespaces, or cache keys. Errored or aborted streams also leave the previous entry
unchanged but propagate their original error without a diagnostic. A normal stream close is the
completion signal in the pinned Next.js contract; it provides no independent expected byte count.
Once complete, the versioned entry, all framework timing and tag metadata, the payload length, and a
SHA-256 payload checksum are published by the same slot-local Lua compare-and-set used for fencing.
Redis `SET` replaces the complete serialized entry atomically, so another instance reads either the
previous document or the new document and never buffered partial bytes. Reads treat malformed JSON,
unsupported versions, invalid metadata, and length or checksum mismatches as cache misses. This
detects stored-value truncation and makes entries from pre-versioned releases non-reusable after an
upgrade.

The verified deployment topology for this stage is a standalone Redis primary endpoint, matching a
Memorystore for Redis primary endpoint; the disposable integration environment uses
`redis:8.2.1-alpine`. The key hash tag also colocates the entry and tag sets for a single Lua operation
on Redis Cluster, but this stage does not claim a Memorystore for Redis Cluster integration run.

This scenario proves shared fresh reuse, restart persistence, immediate explicit-tag invalidation,
stale-write fencing, and the opt-in stale-while-revalidate policy across two processes using the
same build. It pauses a revision 1 source response, commits and invalidates revision 2, lets another
instance publish revision 2, and then releases the older response. The already-running request may
finish with revision 1, while every later request on both instances reuses revision 2. Unrelated
tagged content stays reusable. A separate beta document demonstrates the permitted stale response
and eventual shared reuse of its background-refreshed revision. Package tests use a controllable
clock for exact fresh/stale/expired boundaries and real Redis time with bounded polling for both
entry and delayed tag hard expiration. These package-level scenarios do not make freshness claims
about unrelated HTTP, browser, source-replica, or CDN caches.

## When to split the app

Create a separate test application only when an integration scenario requires configuration or
behavior that would be misleading or unsafe as consumer guidance. If that threshold is reached,
keep `apps/web` canonical and name the additional application after the scenario it isolates.
