# Cache package resource measurement

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
container and a separate Node.js child with test-only garbage collection enabled. The coordinator
enforces a 60-second child timeout. A successful run waits for the child to close its Redis client,
disconnect IPC, and exit naturally before the container is removed. Crash, timeout, and malformed
IPC paths still terminate the child before stopping the container. This command is intentionally
separate from the normal `pnpm test` loop.

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

Absolute heap, RSS, CPU, and event-loop ceilings remain broad bootstrap protections; focused peak-RAM
and performance contracts belong to their dedicated resource tickets. Passing this gate is evidence
that the documented bounded workload releases cache-owned memory and resources. It is not a guarantee
for every input, concurrency level, allocator, host, or future workload.
