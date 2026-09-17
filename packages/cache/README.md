# Redis Cache Components handler

Create every handler namespace from explicit public deployment dimensions:

```ts
import { createCacheNamespace, createRedisCacheHandler } from "unicorn-nextjs-memory-cache";

const handler = createRedisCacheHandler(redis, {
  namespace: createCacheNamespace({
    application: "storefront",
    environment: "production",
    locale: "en-US",
    release: "2026-09-17.2",
    site: "main",
  }),
});
```

`application`, `environment`, `site`, and `locale` form the deployment scope. Processes with the
same five inputs intentionally share entries and durable invalidation state. `release` identifies
the cache-entry serialization and behavior contract: different releases never read one another's
entries, but they share tag invalidation within the same deployment scope so a publication event
reaches every release still serving a rolling deployment.

All inputs are validated and reduced to deterministic SHA-256 identifiers before Redis keys are
constructed. Supply stable, public identifiers only. Never put credentials, authorization values,
visitor identifiers, or private content in namespace inputs, cache arguments, or tags.

The packaged `next-handler` maps `REDIS_CACHE_NAMESPACE`, `REDIS_CACHE_ENVIRONMENT`,
`REDIS_CACHE_RELEASE`, `REDIS_CACHE_SITE`, and `REDIS_CACHE_LOCALE` to this contract. Its local
defaults are for development; deployments should set every value explicitly and change the release
identifier whenever cached serialization or interpretation becomes incompatible.

## Resource measurement

Run the isolated resource harness from the workspace root:

```sh
pnpm measure:cache-resources
```

To reproduce a reported seed exactly:

```sh
pnpm --filter unicorn-nextjs-memory-cache measure:resources --seed 2214606
```

The command directly rebuilds the production Rspack bundle before every run, so a requested
measurement cannot be satisfied by a Turborepo cache hit. It then starts a disposable Redis
container with a separate 128 MiB memory quota and a Node.js child with test-only garbage collection
enabled. The coordinator enforces a 60-second child timeout. A successful run waits for the child to
close its Redis client, disconnect IPC, and exit naturally before the container is removed. Crash,
timeout, and malformed IPC paths still terminate the child before stopping the container. This
command is intentionally separate from the normal `pnpm test` loop.

## Retention workload envelope

The fixed seeded workload uses 4 KiB chunks, four chunks per normal entry, a 20 KiB per-entry limit,
and a 16 KiB aggregate buffered-byte limit across four concurrent streams. It performs two warm-up
batches followed by three equivalent steady-state batches. Each steady-state batch completes 12
writes split between reused and unique keys, then consumes 24 reads through the production bundle's
public handler API.

Separate measured phases exercise:

- entries rejected after crossing the configured per-entry limit;
- ordinary upstream errors and cancellation errors after zero, one, and multiple chunks;
- older and newer writes overlapping on the same key;
- tag invalidation while a streamed write is pending.

After every measured phase, the public resource-state seam records buffered bytes and pending writes,
then four held streams prove that the handler can accept the full 16 KiB aggregate capacity again.
Any retained byte, pending-write record, or capacity shortfall has a zero-byte/zero-record budget.
Parameters, seed, thresholds, Node.js and package versions, the Redis image and server version,
operating system, architecture, and an executable reproduction command are included in the JSON
result. Keys, tags, and payloads are synthetic and are never included in the evidence.

Every phase contains three samples taken after two explicit garbage-collection passes. Evidence
separates V8 heap, external memory, current and peak RSS, CPU time, elapsed time, event-loop
utilization and delay, and active resource types. The `arrayBuffersAndBuffersBytes` field uses
Node.js's `process.memoryUsage().arrayBuffers` value, which includes `ArrayBuffer`,
`SharedArrayBuffer`, and all Node.js `Buffer` allocations. Threshold evaluation is included in the
result and a failed budget gives the command a nonzero exit code.

Warm-up finishes before measured activity starts. Each measured phase begins after explicit GC
stabilization, stops its CPU, elapsed, utilization, and delay counters before post-batch GC samples,
and records the event-loop-delay sample count. Warm-up and cleanup remain visible as lifecycle
memory/resource phases with `activity: null`; they are not folded into measured activity budgets.

Retained growth uses the median of the three stabilized samples in the first and last equivalent
steady-state batches. Positive growth is limited to 4 MiB of V8 heap, 1 MiB of external memory, and
1 MiB of ArrayBuffer/Buffer memory; decreases count as zero rather than requiring exact byte
equality. Cleanup compares the multiset of active Node.js resource types before Redis setup and
after Redis close, and permits no positive delta. The controlled `retained-payload` fixture exceeds
all three growth budgets and leaves one active resource, proving that the evaluator rejects retained
state instead of merely collecting measurements.

## Peak-memory workload envelope

The same production-bundle run separately exercises the documented production defaults: 8 MiB of
metadata plus raw payload per entry and 32 MiB of raw payload across concurrent writes. It records
accepted cases one byte below and exactly at both limits, then rejects one byte above each limit
through the content-free `entry-rejected` diagnostic. The rejected writes preserve the last complete
value and leave zero buffered bytes and pending writes.

The aggregate boundary uses eight deterministic streams. Three additional runs hold eight 4 MiB
streams concurrently at the exact 32 MiB aggregate limit before allowing publication. Each measured
phase samples memory every millisecond while work is active, preserves the phase peak, and also keeps
three stabilized post-phase samples. The repeated phases make the transient publication peak and the
post-GC RSS plateau visible separately, so allocator fragmentation is not mistaken for retained V8,
external, or ArrayBuffer growth. Their stabilized post-GC RSS medians must remain within a 96 MiB
run-to-run range in addition to the absolute memory ceilings.

The portable gate starts Node.js with a 256 MiB V8 old-space ceiling and permits at most 192 MiB each
for used V8 heap, external memory, and ArrayBuffer/Buffer memory, plus 640 MiB current and peak RSS.
On Linux with delegated cgroup v2 memory and CPU controllers, the coordinator also moves the child
into a dedicated cgroup with a 768 MiB total-memory limit, zero swap, and a 0.5-core CPU quota. The
Redis container keeps its independent 128 MiB memory and 0.5-core quotas. On other hosts, or Linux
hosts without delegated controllers, the V8 and metric gates still run and `kernelLimits.status` is
`skipped` with a bounded reason; that result is not kernel-enforced total-RAM or CPU-quota evidence.

The normal command never writes heap diagnostics. After a failed run, reproduce its seed in the
isolated diagnostic mode:

```sh
pnpm --filter unicorn-nextjs-memory-cache measure:resources --seed 2214606 --failure-diagnostics
```

That rerun uses only synthetic keys and payloads, clears its seed-scoped
`packages/cache/.resource-diagnostics/` directory, and writes exactly one diagnostic report and one
heap snapshot while the first eight-stream, 32 MiB peak is still held. Both paths are included in
the evidence and validated as non-empty; a later rerun of the same seed replaces them instead of
accumulating artifacts. The directory is ignored by Git.

Passing this gate is evidence that the documented bounded workload stays inside these explicit
limits and releases cache-owned memory and resources. It is not a guarantee for every input,
concurrency level, allocator, host, or future workload. CPU and event-loop budgets remain broad until
their dedicated performance ticket sharpens them.
