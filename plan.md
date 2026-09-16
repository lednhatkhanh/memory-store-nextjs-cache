# Custom Cache Components library, reference application, and testing strategy

Status: active implementation plan. Recorded 16 September 2026. Completion evidence lives in the
tracked issues; this document does not imply that an unverified milestone is complete.

The production-migration decisions that constrain this package and reference application are
retained in `apps/web/README.md` and tickets 14–18. Payload administration, legacy route ownership,
Cloudflare rule deployment, and CMS migration sequencing remain owned by their respective systems.

## Objective

Build a focused TypeScript package that provides shared Redis storage and distributed invalidation for the Next.js **plural `cacheHandlers` API**, targeting the new ONE App Router frontend on GKE with Memorystore. Maintain `apps/web` as the canonical, production-appropriate best-practice integration that Next.js consumers can follow.

Develop and validate it independently of the existing Pages Router applications and Payload CMS. A small custom content service will make the tests repeatable and let us reproduce failures deliberately.

The first milestone is two production-built Next.js instances sharing Redis, with tests proving that publication through one instance invalidates content used by both, including when an old render finishes after invalidation.

## Scope and ownership

| Concern                                                                          | Owner                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------- |
| Cache entry storage, serialization, expiration, distributed tag state            | This package                                   |
| App Router, Cache Components, streaming, partial prefetching, client navigation  | Next.js; exercised by the reference application |
| Public versus personalized data, site/locale inputs, authorization               | Application                                    |
| Committed content updates, durable publish events, dependency selection, retries | Content/Payload integration                    |
| HTTP cache headers, Cloudflare rules and purges, ingress routing                 | Application and infrastructure                 |

The reference application is a first-class deliverable with durable, production-appropriate
application paths. It must demonstrate supported library setup through public entry points and
current Next.js conventions. The integration suites use this same application so the tested and
recommended configurations cannot drift. Create a separate scenario application only when a
test-only requirement would make the canonical example misleading or unsafe.

Instant navigation is a compatibility requirement. The package does not implement a router or replace Next.js prefetching. The reference application enables `cacheComponents: true` and `partialPrefetching: true`, and browser tests check their behavior. [Next.js instant navigation](https://nextjs.org/docs/app/guides/instant-navigation).

Initial support:

- Node.js runtime, App Router, and standalone deployments.
- An explicitly pinned and tested current Next.js release.
- The plural handler contract and the cache directives actually used by the new application; start with the `default` handler for `'use cache'`.
- One Redis client and the Redis topology selected for Memorystore.
- Shared public content caching, explicit tags, implicit route tags, and the applicable expiration/revalidation semantics.
- Environment and deployment namespaces, bounded resource use, diagnostics, and explicit failure behavior.

Initially exclude Pages Router compatibility, the singular `cacheHandler` API, additional storage backends, and an extra per-process content cache. Add a `remote` handler registration only when it is needed and covered by integration tests.

Excluding the singular API does **not** establish that every Next.js cache layer is now shared. Inventory the reference application's generated output and runtime behavior, including prerendered/build artifacts. Verify those layers before claiming that a route has the required freshness behavior.

“Latest features” means adopting a current release and pinning it. Each upgrade must pass the compatibility suite before we declare support. Avoid an untested, open-ended compatibility promise.

## Correctness contract

For immediate invalidation, the target is:

> After the source content is committed and invalidation completes successfully, a new server request must not reuse an entry created before that invalidation, under the documented healthy operating conditions.

Conditions include an available authoritative Redis primary, a source that exposes the committed revision, and correctly specified content dependencies. A delayed replica or an independently cached source response can defeat freshness even when the handler works correctly.

Distinguish these cases:

- An already-running request may finish with the revision it previously read. It must not make that revision reusable by subsequent requests after invalidation.
- Stale-while-revalidate intentionally permits a stale response under its configured policy. Test it separately from immediate expiration.
- Already-open pages and previously prefetched client views retain their normal client-cache lifecycle. Do not introduce forced reloads or publish-driven polling.
- Authentication transitions still require correct session and client-state handling.
- Package invalidation completion is one step in the application's publication workflow, not proof that Cloudflare, source replicas, or all dependent routes are fresh.

Under failures, availability and freshness need an explicit policy. Cache reads can fall back to fresh source rendering when that is possible. Failed invalidations must remain observable and retryable; the application must not report successful publication propagation when required invalidation work failed.

## Implementation requirements

Use the documented handler contract as the starting point: `get`, `set`, `refreshTags`, `getExpiration`, and `updateTags`. Handle explicit tags and implicit route tags so path revalidation is covered. Cache entries include streamed values and timing metadata. [Next.js cacheHandlers API](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers).

The design must address:

1. **Complete writes.** Serialize streams safely, reject incomplete entries, preserve metadata, and publish stored entries atomically. Bound entry size and buffering.
2. **Invalidation races.** Prevent a render begun before an invalidation from restoring reusable old content. Select and document a timestamp/generation strategy, including ordering and clock assumptions, before implementation.
3. **Shared invalidation state.** A pod must learn about invalidations made by another pod. Pub/Sub may be an optimization, but cannot be the only record of invalidation.
4. **Expiration semantics.** Distinguish freshness, stale-while-revalidate, and hard expiration. Test boundary cases and delayed invalidation where supported by the pinned contract.
5. **Metadata lifetime.** Evicting tag metadata while associated entries survive must not make obsolete entries valid again. Define retention, missing-metadata behavior, and memory bounds together.
6. **Deployment boundaries.** Isolate incompatible cache entries by environment/release. Publication must reach every release still serving traffic, through a shared compatible invalidation mechanism or explicit fan-out.
7. **Failures and recovery.** Bound connection and operation times, avoid retry storms, and expose failures. Redis restart/failover and restored older state require a documented recovery policy; an acknowledged invalidation must not silently be assumed durable forever.
8. **Operational visibility.** Expose cache hits/misses, source fallback, latency, invalidation failures, and rejected stale writes without logging content, credentials, or high-cardinality raw keys by default.

Prefer a small implementation whose behavior is understandable. Start without per-pod content caching, then measure Redis traffic and latency before adding another consistency mechanism.

## Test environment

All components can run in Docker. For faster local iteration, Redis can run in Docker while the test runner, content server, and Next.js instances run as local processes.

| Component              | Role                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| Redis container        | Real storage, expiration, scripting/transactions, disconnect and restart behavior |
| Custom content service | Shared, controllable source of truth for both Next.js instances                   |
| Next.js instance A     | Production-built application using the package                                    |
| Next.js instance B     | Independent process using the same build and Redis namespace                      |
| Test runner            | Starts services, controls scenarios, checks HTTP results and diagnostics          |
| Playwright             | Checks browser navigation, prefetching, streaming, and session separation         |

Use Testcontainers to manage disposable Redis containers and connection details. Its Redis module supports container lifecycle and restart scenarios. Pin the Redis image, preferably by digest, to the selected production-compatible version. [Testcontainers Redis module](https://node.testcontainers.org/modules/redis/).

Use production builds of the reference application for the Next.js suites, including its standalone output. Run independent processes to expose process-local state. Docker access is required in CI. [Next.js Playwright guidance](https://nextjs.org/docs/app/guides/testing/playwright).

## Custom content service

A small Node.js HTTP service is sufficient. It should hold content independently of the Redis cache being tested, so cache outages do not also remove the source of truth. Both Next.js instances must read the same service.

Example test-only capabilities:

| Operation                                            | Purpose                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Read a document by site, locale, and slug            | Return content with an explicit revision number            |
| Commit an update or deletion                         | Advance a revision and change the source deterministically |
| Count source reads                                   | Establish that a cache hit actually avoided a source read  |
| Pause a selected response after capturing a revision | Reproduce an old render racing with a new publication      |
| Release a paused response                            | Control the exact ordering of operations                   |
| Return a selected error or delay                     | Exercise source failure and recovery                       |
| Reset scenario state                                 | Isolate tests                                              |

The test orchestrator commits a source change, then calls a production-appropriate invalidation seam in the Next.js reference application. That seam invokes the normal Next.js revalidation APIs. This tests the framework integration as well as the underlying handler.

Keep source reads uncached at the HTTP layer and avoid a second application cache around them. Build-time access must be explicit: tests control which revision exists during build and which exists during runtime.

Place deterministic control endpoints in the test-only content service rather than in consumer-facing application paths. The service simulates the content behavior required by the tests; it does not claim to reproduce Payload transactions, access control, or publishing hooks.

## Test layers

### 1. Unit and model tests

Test pure serialization helpers, metadata validation, namespace construction, expiry calculations, and invalidation ordering. Use a controllable clock where appropriate.

Add generated sequences of reads, writes, invalidations, and time advances against a simple reference model. Record random seeds so failures can be reproduced. Use mutation tests selectively to check whether critical assertions detect deliberately broken invalidation behavior.

### 2. Handler integration against real Redis

Exercise the actual package with independent handler instances and Redis clients. Verify stored data, expiry, invalidation, malformed entries, partial streams, operation failures, and metadata loss. Mocks can isolate unit behavior but cannot establish Redis correctness.

### 3. Production Next.js integration

Build the focused, consumer-quality App Router reference application and boot two instances. Test through real framework requests and APIs, including `'use cache'`, `cacheTag`, `cacheLife`, immediate tag expiration, stale-while-revalidate, and path invalidation. Exercise Server Action-only behavior through a Server Action where applicable.

Check page content, metadata, cached layout dependencies, and source read counts. A direct handler test passing does not establish that Next.js used it as expected.

### 4. Browser integration

Use separate browser contexts for anonymous users, authenticated user A, authenticated user B, and preview sessions. Test direct visits, soft navigation, partial prefetching, back/forward navigation, streaming fallbacks, and login/logout transitions.

Check the expected client-cache lifecycle explicitly. A prefetched revision persisting within the accepted client lifetime is different from a new origin request receiving an invalidated server entry.

### 5. Staging deployment validation

Run the reference application or pilot application against actual Memorystore and GKE on `stage.one-line.com`. Validate topology, timeouts, failover recovery, ingress streaming, rollout behavior, and Cloudflare rules. Docker tests do not reproduce the complete managed deployment.

The existing requirement remains: `/one-ecom` and `/ecom`, including applicable aliases and transport paths, must bypass shared response caching. This is an infrastructure/application acceptance check, not something the handler can enforce by inspecting opaque cache entries.

## Essential scenario matrix

| Scenario                                       | Required assertion                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| Cold read followed by warm reads               | Correct revision; warm reads avoid unnecessary source calls                          |
| Cross-instance cache reuse                     | Both processes can use the shared entry                                              |
| Immediate invalidation on A                    | Subsequent server reads on A and B cannot reuse the old revision                     |
| SWR invalidation                               | Stale serving and eventual refresh follow the selected policy                        |
| Path invalidation                              | Implicit route tags invalidate the relevant cached dependencies                      |
| Unrelated tags                                 | Invalidating one dependency leaves unrelated content usable                          |
| Invalidation during a pending render           | Late completion cannot restore reusable old content                                  |
| Two overlapping publications                   | An older completion cannot replace the newest valid state                            |
| Stream failure or oversized entry              | No partial entry is served; resource limits are enforced                             |
| Redis timeout/disconnect                       | Reads and writes follow bounded failure behavior; invalidation failure is observable |
| Reconnect, restart, restored older state       | Recovery does not silently accept obsolete invalidation state                        |
| Tag metadata eviction                          | Remaining entries cannot become falsely fresh                                        |
| Source outage or deletion                      | An outage is distinguished from a confirmed missing document                         |
| Pod restart and rolling deployment             | Isolation and invalidation work for every serving release                            |
| Build revision differs from published revision | Build artifacts do not silently restore outdated content                             |
| Site/locale/environment differences            | Entries are partitioned according to the application's inputs                        |
| Anonymous, authenticated, and preview requests | No private or draft content crosses sessions through shared caching                  |
| Prefetch followed by publication               | Observed client reuse matches policy; new server reads satisfy freshness             |

## Deterministic stale-write test

1. Start Redis, the content service, and Next.js instances A and B with an isolated test namespace.
2. Establish revision 1 and warm the relevant caches.
3. Arrange a cache miss or refresh on B and pause its source response **after it captures revision 1**. Confirm the pause through an explicit signal.
4. Commit revision 2 in the source service.
5. Request immediate invalidation through A and wait for its successful completion.
6. Release B's paused response and let the old render finish.
7. Make new server requests directly to A and B.
8. Assert both observe revision 2 and that revision 1 was not restored as a reusable entry.

Use barriers and controllable promises instead of arbitrary sleeps to arrange the race. Real expiry tests can use bounded polling; JavaScript fake timers alone do not advance Redis's clock. Capture process logs, revision identifiers, and operation ordering on failure.

## CI and release strategy

- **Every pull request:** unit/model tests, Redis integration, production-build smoke tests, and core cross-instance/race scenarios.
- **Scheduled or release checks:** broader browser coverage, repeated concurrency tests, disconnect/restart scenarios, load and memory measurements, and build/rollout tests.
- **Before production adoption:** staging Memorystore/GKE tests, Payload publish integration, authenticated-session isolation, and Cloudflare response checks.
- **On Next.js upgrades:** rerun the full compatibility suite and inspect changes to the handler contract and relevant framework behavior before widening support.

Give each test run a unique namespace and clean up its resources. Parallel workers must not flush a shared Redis database or modify one another's source state. Keep destructive container scenarios isolated from other tests.

The release gate is evidence for the correctness contract, not a target number of tests or a coverage percentage. Record tested versions, known limitations, failure policy, and performance results in the package documentation.

## Weekend milestones

### First weekend: prove the core behavior

- Scaffold the package and the focused, production-built Next.js reference application.
- Start Redis through Testcontainers and implement the controllable content service.
- Define the invalidation ordering contract and implement the minimum complete handler needed by the reference application.
- Pass cold/warm reads, cross-instance immediate invalidation, and the stale-write race test.
- Document remaining gaps. This milestone is a prototype, not production approval.

### Following iterations

- Complete expiration/path semantics, failure recovery, and metadata-retention tests.
- Add standalone packaging, browser navigation, session isolation, and deployment tests.
- Measure Redis traffic and latency before introducing optimizations.
- Integrate Payload publication after commit with retries and revision verification.
- Run on staging before selecting a public production pilot route.

## Reference implementations

Study the official Next.js handler contract and implementation first. Other packages can provide useful examples and regression scenarios:

- [Turbo Redis cache](https://github.com/trieb-work/nextjs-turbo-redis-cache)
- [leejpsd cache handler](https://github.com/leejpsd/nextjs-cache-handler)
- [flefebvre Redis cache handler](https://github.com/flolefebvre/nextjs-redis-cache-handler)

These are research references, not dependencies or endorsements. Verify their current behavior before adopting an approach. Record provenance and preserve applicable license notices for reused code. Derive acceptance tests from our own required behavior so the tests can expose mistakes in either a custom or borrowed implementation.
