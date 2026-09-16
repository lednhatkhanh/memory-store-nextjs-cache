import { readFile } from "node:fs/promises";
import { arch, platform, release, type as operatingSystemType } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import { Redis } from "ioredis";

import {
  RESOURCE_EVIDENCE_SCHEMA_VERSION,
  type EventLoopDelayEvidence,
  type ResourceActivityEvidence,
  type ResourceLifecyclePhaseName,
  type ResourceMeasurementPhaseName,
  type ResourcePhaseEvidence,
  type ResourceReleaseCheckEvidence,
  type ResourceRunEvidence,
  type ResourceSampleEvidence,
  type ResourceWorkloadParameters,
} from "./evidence.ts";
import { parseResourceChildRequest, type ResourceChildRequest } from "./protocol.ts";
import { evaluateResourceThresholds, type ResourceObservations } from "./thresholds.ts";

type PackageMetadata = Readonly<{ name: string; version: string }>;
type SeededRandom = () => number;
type MeasurementCacheEntry = Readonly<{
  expire: number;
  revalidate: number;
  stale: number;
  tags: string[];
  timestamp: number;
  value: ReadableStream<Uint8Array>;
}>;
type MeasurementResourceState = Readonly<{ bufferedBytes: number; pendingWrites: number }>;
type MeasurementRedisCacheHandler = Readonly<{
  get: (cacheKey: string, softTags: string[]) => Promise<MeasurementCacheEntry | undefined>;
  getResourceState: () => MeasurementResourceState;
  set: (cacheKey: string, pendingEntry: Promise<MeasurementCacheEntry>) => Promise<void>;
  updateTags: (tags: string[], durations?: { expire?: number }) => Promise<void>;
}>;
type ProductionPackage = Readonly<{
  createRedisCacheHandler: (
    client: Redis,
    options: Readonly<{
      maxBufferedBytes: number;
      maxEntrySizeBytes: number;
      namespace: string;
    }>,
  ) => MeasurementRedisCacheHandler;
  packageIdentity: string;
}>;
type HeldPayload = Readonly<{
  buffered: Promise<true>;
  release: () => void;
  stream: ReadableStream<Uint8Array>;
}>;

function isProductionPackage(value: unknown): value is ProductionPackage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "packageIdentity") === "string" &&
    typeof Reflect.get(value, "createRedisCacheHandler") === "function"
  );
}

function seededRandom(seed: number): SeededRandom {
  const modulus = 4_294_967_296;
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223 + modulus) % modulus;
    return state / modulus;
  };
}

function streamedPayload(
  random: SeededRandom,
  chunkBytes: number,
  chunkCount: number,
): ReadableStream<Uint8Array> {
  const byte = Math.floor(random() * 256);
  let emittedChunks = 0;
  return new ReadableStream({
    async pull(controller) {
      await yieldToEventLoop();
      if (emittedChunks === chunkCount) {
        controller.close();
        return;
      }
      const chunk = new Uint8Array(chunkBytes);
      chunk.fill(byte);
      emittedChunks += 1;
      controller.enqueue(chunk);
    },
  });
}

function rejectedPayload(
  random: SeededRandom,
  chunkBytes: number,
  chunksBeforeFailure: number,
  error: Error,
): ReadableStream<Uint8Array> {
  const byte = Math.floor(random() * 256);
  let emittedChunks = 0;
  return new ReadableStream({
    async pull(controller) {
      await yieldToEventLoop();
      if (emittedChunks === chunksBeforeFailure) {
        controller.error(error);
        return;
      }
      const chunk = new Uint8Array(chunkBytes);
      chunk.fill(byte);
      emittedChunks += 1;
      controller.enqueue(chunk);
    },
  });
}

function heldPayload(byteCount: number, byte: number): HeldPayload {
  const buffered = Promise.withResolvers<true>();
  const released = Promise.withResolvers<true>();
  let emitted = false;
  return {
    buffered: buffered.promise,
    release() {
      released.resolve(true);
    },
    stream: new ReadableStream({
      async pull(controller) {
        if (!emitted) {
          emitted = true;
          const chunk = new Uint8Array(byteCount);
          chunk.fill(byte);
          controller.enqueue(chunk);
          buffered.resolve(true);
          return;
        }
        await released.promise;
        controller.close();
      },
    }),
  };
}

function activeResourceTypes(): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const resourceType of process.getActiveResourcesInfo().toSorted()) {
    counts[resourceType] = (counts[resourceType] ?? 0) + 1;
  }
  return counts;
}

function activeResourceDelta(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const delta: Record<string, number> = {};
  const resourceTypes = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const resourceType of resourceTypes) {
    const difference = (after[resourceType] ?? 0) - (before[resourceType] ?? 0);
    if (difference !== 0) delta[resourceType] = difference;
  }
  return delta;
}

async function stabilizeGarbageCollection(passes: number): Promise<void> {
  const collectGarbage: unknown = Reflect.get(globalThis, "gc");
  if (typeof collectGarbage !== "function") {
    throw new Error("Resource measurement child requires --expose-gc");
  }
  for (let pass = 0; pass < passes; pass += 1) {
    Reflect.apply(collectGarbage, globalThis, []);
    // oxlint-disable-next-line no-await-in-loop -- Every collection must settle before the next.
    await yieldToEventLoop();
  }
}

async function captureSamples(
  workload: ResourceWorkloadParameters,
): Promise<ResourceSampleEvidence[]> {
  const samples: ResourceSampleEvidence[] = [];
  for (let index = 0; index < workload.samplesPerPhase; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Comparable samples use identical GC stabilization.
    await stabilizeGarbageCollection(workload.garbageCollectionPassesPerSample);
    const memory = process.memoryUsage();
    samples.push({
      activeResourceTypes: activeResourceTypes(),
      memory: {
        arrayBuffersAndBuffersBytes: memory.arrayBuffers,
        currentRssBytes: memory.rss,
        externalBytes: memory.external,
        peakRssBytes: process.resourceUsage().maxRSS * 1_024,
        v8HeapTotalBytes: memory.heapTotal,
        v8HeapUsedBytes: memory.heapUsed,
      },
    });
  }
  return samples;
}

function nanosecondsToMilliseconds(value: number): number {
  return value / 1_000_000;
}

function eventLoopDelay(
  histogram: ReturnType<typeof monitorEventLoopDelay>,
): EventLoopDelayEvidence {
  if (histogram.count === 0) {
    return {
      maximumMilliseconds: 0,
      meanMilliseconds: 0,
      minimumMilliseconds: 0,
      p50Milliseconds: 0,
      p95Milliseconds: 0,
      p99Milliseconds: 0,
      sampleCount: 0,
    };
  }
  return {
    maximumMilliseconds: nanosecondsToMilliseconds(histogram.max),
    meanMilliseconds: nanosecondsToMilliseconds(histogram.mean),
    minimumMilliseconds: nanosecondsToMilliseconds(histogram.min),
    p50Milliseconds: nanosecondsToMilliseconds(histogram.percentile(50)),
    p95Milliseconds: nanosecondsToMilliseconds(histogram.percentile(95)),
    p99Milliseconds: nanosecondsToMilliseconds(histogram.percentile(99)),
    sampleCount: histogram.count,
  };
}

async function measureWorkloadPhase(
  name: ResourceMeasurementPhaseName,
  workload: ResourceWorkloadParameters,
  run: () => Promise<ResourceReleaseCheckEvidence>,
): Promise<ResourcePhaseEvidence> {
  await stabilizeGarbageCollection(workload.garbageCollectionPassesPerSample);
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  await yieldToEventLoop();
  histogram.reset();
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const startedEventLoop = performance.eventLoopUtilization();
  let activity: ResourceActivityEvidence | undefined;
  let releaseCheck: ResourceReleaseCheckEvidence | undefined;

  try {
    releaseCheck = await run();
    const cpu = process.cpuUsage(startedCpu);
    const eventLoop = performance.eventLoopUtilization(startedEventLoop);
    activity = {
      elapsedMilliseconds: performance.now() - startedAt,
      eventLoop: {
        activeMilliseconds: eventLoop.active,
        delay: eventLoopDelay(histogram),
        idleMilliseconds: eventLoop.idle,
        utilization: eventLoop.utilization,
      },
      systemCpuMilliseconds: cpu.system / 1_000,
      userCpuMilliseconds: cpu.user / 1_000,
    };
  } finally {
    histogram.disable();
  }
  if (!activity || !releaseCheck) throw new Error(`Resource phase ${name} did not record evidence`);
  const samples = await captureSamples(workload);
  return { activity, name, releaseCheck, samples };
}

async function captureLifecyclePhase(
  name: ResourceLifecyclePhaseName,
  workload: ResourceWorkloadParameters,
  transition: () => Promise<void>,
): Promise<ResourcePhaseEvidence> {
  await transition();
  const samples = await captureSamples(workload);
  return { activity: null, name, releaseCheck: null, samples };
}

function createEntry(
  value: ReadableStream<Uint8Array>,
  tags: string[],
  timestamp: number,
): MeasurementCacheEntry {
  return { expire: 3_600, revalidate: 300, stale: 60, tags, timestamp, value };
}

function standardEntry(
  random: SeededRandom,
  tags: string[],
  timestamp: number,
  workload: ResourceWorkloadParameters,
): MeasurementCacheEntry {
  return createEntry(
    streamedPayload(random, workload.chunkBytes, workload.streamChunks),
    tags,
    timestamp,
  );
}

function timestampGenerator(): () => number {
  let previous = 0;
  return () => {
    const current = performance.timeOrigin + performance.now();
    previous = Math.max(current, previous + 0.001);
    return previous;
  };
}

async function expectRejection(promise: Promise<void>, expectedMessage: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) return;
    throw error;
  }
  throw new Error(`Expected workload rejection: ${expectedMessage}`);
}

async function runSteadyStateBatch(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
  batchName: string,
): Promise<void> {
  const writtenKeys: string[] = [];
  for (let index = 0; index < workload.writesPerBatch; index += 1) {
    const cacheKey =
      index % 2 === 0
        ? `resource-reused-${index % workload.keyCount}`
        : `resource-unique-${batchName}-${index}`;
    const tag = `resource-tag-${Math.floor(random() * workload.tagCount)}`;
    writtenKeys.push(cacheKey);
    // oxlint-disable-next-line no-await-in-loop -- Sequential writes keep the seeded order fixed.
    await handler.set(
      cacheKey,
      Promise.resolve(standardEntry(random, [tag], nextTimestamp(), workload)),
    );
  }

  for (let index = 0; index < workload.readsPerBatch; index += 1) {
    const cacheKey = writtenKeys[Math.floor(random() * writtenKeys.length)];
    if (!cacheKey) throw new Error("Steady-state workload did not produce a readable key");
    // oxlint-disable-next-line no-await-in-loop -- Sequential reads keep the seeded order fixed.
    const entry = await handler.get(cacheKey, []);
    if (!entry) throw new Error("Steady-state workload did not retrieve a completed entry");
    // oxlint-disable-next-line no-await-in-loop -- Every restored stream is consumed before reuse.
    await new Response(entry.value).arrayBuffer();
  }
}

async function runOversizedEntries(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
): Promise<void> {
  const oversizedChunkCount = Math.floor(workload.maxEntrySizeBytes / workload.chunkBytes) + 2;
  for (let attempt = 0; attempt < workload.concurrentStreamsPerBatch; attempt += 1) {
    const entry = createEntry(
      streamedPayload(random, workload.chunkBytes, oversizedChunkCount),
      [],
      nextTimestamp(),
    );
    // oxlint-disable-next-line no-await-in-loop -- Each rejection must settle before reuse is tested.
    await expectRejection(
      handler.set(`resource-oversized-${attempt}`, Promise.resolve(entry)),
      "Redis cache entry rejected: entry-size-limit",
    );
  }
}

function failureBoundaries(workload: ResourceWorkloadParameters): number[] {
  return [...new Set([0, 1, Math.max(2, workload.streamChunks - 1)])];
}

async function runRejectedStreams(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
  kind: "cancellation" | "upstream-error",
): Promise<void> {
  for (const boundary of failureBoundaries(workload)) {
    const message = `${kind} after ${boundary} chunks`;
    const error =
      kind === "cancellation" ? new DOMException(message, "AbortError") : new Error(message);
    const entry = createEntry(
      rejectedPayload(random, workload.chunkBytes, boundary, error),
      [],
      nextTimestamp(),
    );
    // oxlint-disable-next-line no-await-in-loop -- Chunk boundaries are isolated and settled in order.
    await expectRejection(
      handler.set(`resource-${kind}-${boundary}`, Promise.resolve(entry)),
      message,
    );
  }
}

async function runOverlappingWrites(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
): Promise<void> {
  for (let index = 0; index < workload.concurrentStreamsPerBatch; index += 1) {
    const olderEntry = Promise.withResolvers<MeasurementCacheEntry>();
    const cacheKey = `resource-overlap-${index}`;
    const olderTimestamp = nextTimestamp();
    const olderWrite = handler.set(cacheKey, olderEntry.promise);
    // oxlint-disable-next-line no-await-in-loop -- Newer completion precedes the older one by design.
    await handler.set(
      cacheKey,
      Promise.resolve(standardEntry(random, [], nextTimestamp(), workload)),
    );
    olderEntry.resolve(standardEntry(random, [], olderTimestamp, workload));
    // oxlint-disable-next-line no-await-in-loop -- The superseded write must settle before the next pair.
    await olderWrite;
  }
}

async function runInvalidationDuringWrite(
  handler: MeasurementRedisCacheHandler,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
): Promise<void> {
  for (let index = 0; index < workload.invalidationsPerBatch; index += 1) {
    const tag = `resource-pending-tag-${index}`;
    const cacheKey = `resource-pending-invalidation-${index}`;
    const payload = heldPayload(workload.chunkBytes, index);
    const write = handler.set(
      cacheKey,
      Promise.resolve(createEntry(payload.stream, [tag], nextTimestamp())),
    );
    // oxlint-disable-next-line no-await-in-loop -- Invalidation is intentionally between stream chunks.
    await payload.buffered;
    // oxlint-disable-next-line no-await-in-loop -- Each pending write has its own invalidation boundary.
    await handler.updateTags([tag], { expire: 0 });
    payload.release();
    // oxlint-disable-next-line no-await-in-loop -- The invalidated write must settle before verification.
    await write;
    // oxlint-disable-next-line no-await-in-loop -- Publication is observed through the public seam.
    const restored = await handler.get(cacheKey, []);
    if (restored) throw new Error("Invalidated pending write was unexpectedly published");
  }
}

async function probeFullBufferedCapacity(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
  phaseName: ResourceMeasurementPhaseName,
): Promise<number> {
  const streamCount = workload.concurrentStreamsPerBatch;
  if (workload.maxBufferedBytes % streamCount !== 0) {
    throw new Error("maxBufferedBytes must be divisible by concurrentStreamsPerBatch");
  }
  const bytesPerStream = workload.maxBufferedBytes / streamCount;
  const payloads = Array.from({ length: streamCount }, (_, index) =>
    heldPayload(bytesPerStream, Math.floor(random() * 256) + index),
  );
  const writes = payloads.map(
    async (payload, index) =>
      await handler.set(
        `resource-capacity-${phaseName}-${index}`,
        Promise.resolve(createEntry(payload.stream, [], nextTimestamp())),
      ),
  );

  await Promise.all(payloads.map(async (payload) => payload.buffered));
  const acceptedBufferedBytes = handler.getResourceState().bufferedBytes;
  for (const payload of payloads) payload.release();
  await Promise.allSettled(writes);
  return acceptedBufferedBytes;
}

async function runPhaseAndProbe(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
  phaseName: ResourceMeasurementPhaseName,
  run: () => Promise<void>,
): Promise<ResourceReleaseCheckEvidence> {
  await run();
  const afterPhase = handler.getResourceState();
  const acceptedBufferedBytes = await probeFullBufferedCapacity(
    handler,
    random,
    workload,
    nextTimestamp,
    phaseName,
  );
  const afterProbe = handler.getResourceState();
  return {
    acceptedBufferedBytes,
    bufferedBytesAfter: Math.max(afterPhase.bufferedBytes, afterProbe.bufferedBytes),
    pendingWritesAfter: Math.max(afterPhase.pendingWrites, afterProbe.pendingWrites),
  };
}

function median(values: number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (typeof upper !== "number") throw new Error("Cannot calculate a median without samples");
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  if (typeof lower !== "number") {
    throw new Error("Cannot calculate an even median without two samples");
  }
  return (lower + upper) / 2;
}

function retainedGrowth(
  phases: ResourcePhaseEvidence[],
  select: (sample: ResourceSampleEvidence) => number,
): number {
  const steadyStatePhases = phases.filter((phase) => phase.name.startsWith("steady-state-batch-"));
  const first = steadyStatePhases[0];
  const last = steadyStatePhases.at(-1);
  if (!first || !last) throw new Error("Resource measurement did not record steady-state phases");
  return Math.max(0, median(last.samples.map(select)) - median(first.samples.map(select)));
}

function summarizeObservations(
  phases: ResourcePhaseEvidence[],
  resourceDelta: Readonly<Record<string, number>>,
  workload: ResourceWorkloadParameters,
): ResourceObservations {
  const samples = phases.flatMap((phase) => phase.samples);
  const activities = phases.flatMap((phase) => (phase.activity ? [phase.activity] : []));
  const releaseChecks = phases.flatMap((phase) => (phase.releaseCheck ? [phase.releaseCheck] : []));
  if (activities.length === 0 || releaseChecks.length === 0) {
    throw new Error("Resource measurement did not record measured activity");
  }
  return {
    activeResourceDeltaCount: Object.values(resourceDelta).reduce(
      (total, count) => total + Math.max(0, count),
      0,
    ),
    elapsedMilliseconds: activities.reduce(
      (total, activity) => total + activity.elapsedMilliseconds,
      0,
    ),
    maxArrayBuffersAndBuffersBytes: Math.max(
      ...samples.map((sample) => sample.memory.arrayBuffersAndBuffersBytes),
    ),
    maxBufferedBytesAfterPhase: Math.max(
      ...releaseChecks.map((releaseCheck) => releaseCheck.bufferedBytesAfter),
    ),
    maxCapacityShortfallBytesAfterPhase: Math.max(
      ...releaseChecks.map((releaseCheck) =>
        Math.max(0, workload.maxBufferedBytes - releaseCheck.acceptedBufferedBytes),
      ),
    ),
    maxCurrentRssBytes: Math.max(...samples.map((sample) => sample.memory.currentRssBytes)),
    maxEventLoopDelayP99Milliseconds: Math.max(
      ...activities.map((activity) => activity.eventLoop.delay.p99Milliseconds),
    ),
    maxEventLoopUtilization: Math.max(
      ...activities.map((activity) => activity.eventLoop.utilization),
    ),
    maxExternalBytes: Math.max(...samples.map((sample) => sample.memory.externalBytes)),
    maxHeapUsedBytes: Math.max(...samples.map((sample) => sample.memory.v8HeapUsedBytes)),
    maxPendingWritesAfterPhase: Math.max(
      ...releaseChecks.map((releaseCheck) => releaseCheck.pendingWritesAfter),
    ),
    peakRssBytes: Math.max(...samples.map((sample) => sample.memory.peakRssBytes)),
    retainedArrayBuffersAndBuffersGrowthBytes: retainedGrowth(
      phases,
      (sample) => sample.memory.arrayBuffersAndBuffersBytes,
    ),
    retainedExternalGrowthBytes: retainedGrowth(phases, (sample) => sample.memory.externalBytes),
    retainedHeapGrowthBytes: retainedGrowth(phases, (sample) => sample.memory.v8HeapUsedBytes),
    systemCpuMilliseconds: activities.reduce(
      (total, activity) => total + activity.systemCpuMilliseconds,
      0,
    ),
    userCpuMilliseconds: activities.reduce(
      (total, activity) => total + activity.userCpuMilliseconds,
      0,
    ),
  };
}

async function packageMetadata(): Promise<PackageMetadata> {
  const contents = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const parsed: unknown = JSON.parse(contents);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    !("version" in parsed) ||
    typeof parsed.name !== "string" ||
    typeof parsed.version !== "string"
  ) {
    throw new Error("Cache package metadata is malformed");
  }
  return { name: parsed.name, version: parsed.version };
}

function redisVersion(serverInformation: string): string {
  const version = /^redis_version:(.+)$/mu.exec(serverInformation)?.[1]?.trim();
  if (!version) throw new Error("Redis server did not report its version");
  return version;
}

async function runMeasurement(request: ResourceChildRequest): Promise<ResourceRunEvidence> {
  const packageBuildUrl = new URL("../dist/index.js", import.meta.url);
  const productionPackage: unknown = await import(packageBuildUrl.href);
  const metadata = await packageMetadata();
  if (!isProductionPackage(productionPackage)) {
    throw new Error("Production package build does not expose the expected public API");
  }
  if (productionPackage.packageIdentity !== metadata.name) {
    throw new Error("Production package identity does not match package metadata");
  }

  const activeResourceTypesBeforeSetup = activeResourceTypes();
  const redis = new Redis({ host: request.connection.host, port: request.connection.port });
  let redisClientClosed = false;
  const phases: ResourcePhaseEvidence[] = [];
  const random = seededRandom(request.workload.seed);
  const nextTimestamp = timestampGenerator();
  const handler = productionPackage.createRedisCacheHandler(redis, {
    maxBufferedBytes: request.workload.maxBufferedBytes,
    maxEntrySizeBytes: request.workload.maxEntrySizeBytes,
    namespace: `resource-measurement:${request.workload.seed}`,
  });

  try {
    await redis.ping();
    const serverInformation = await redis.info("server");
    phases.push(
      await captureLifecyclePhase("post-warmup", request.workload, async () => {
        for (let batch = 0; batch < request.workload.warmupBatches; batch += 1) {
          // oxlint-disable-next-line no-await-in-loop -- Warm-up is deliberately sequential.
          await runSteadyStateBatch(
            handler,
            random,
            request.workload,
            nextTimestamp,
            `warmup-${batch + 1}`,
          );
        }
      }),
    );

    for (let batch = 0; batch < request.workload.measurementBatches; batch += 1) {
      const name = `steady-state-batch-${batch + 1}` as const;
      // oxlint-disable-next-line no-await-in-loop -- Each measured phase must settle independently.
      const phase = await measureWorkloadPhase(name, request.workload, async () =>
        runPhaseAndProbe(handler, random, request.workload, nextTimestamp, name, async () =>
          runSteadyStateBatch(handler, random, request.workload, nextTimestamp, name),
        ),
      );
      phases.push(phase);
    }

    const churnPhases: Array<readonly [ResourceMeasurementPhaseName, () => Promise<void>]> = [
      [
        "rejected-oversized-entries",
        async () => runOversizedEntries(handler, random, request.workload, nextTimestamp),
      ],
      [
        "upstream-stream-errors",
        async () =>
          runRejectedStreams(handler, random, request.workload, nextTimestamp, "upstream-error"),
      ],
      [
        "cancelled-streams",
        async () =>
          runRejectedStreams(handler, random, request.workload, nextTimestamp, "cancellation"),
      ],
      [
        "overlapping-writes",
        async () => runOverlappingWrites(handler, random, request.workload, nextTimestamp),
      ],
      [
        "invalidation-during-write",
        async () => runInvalidationDuringWrite(handler, request.workload, nextTimestamp),
      ],
    ];
    for (const [name, run] of churnPhases) {
      // oxlint-disable-next-line no-await-in-loop -- Each failure mode gets an isolated measurement.
      const phase = await measureWorkloadPhase(name, request.workload, async () =>
        runPhaseAndProbe(handler, random, request.workload, nextTimestamp, name, run),
      );
      phases.push(phase);
    }

    phases.push(
      await captureLifecyclePhase("post-cleanup", request.workload, async () => {
        await redis.quit();
        redisClientClosed = true;
      }),
    );

    const cleanupSample = phases.at(-1)?.samples.at(-1);
    if (!cleanupSample) throw new Error("Resource cleanup phase did not produce a sample");
    const activeResourceTypesAfterCleanup = cleanupSample.activeResourceTypes;
    const resourceDelta = activeResourceDelta(
      activeResourceTypesBeforeSetup,
      activeResourceTypesAfterCleanup,
    );
    const observations = summarizeObservations(phases, resourceDelta, request.workload);

    return {
      cleanup: {
        activeResourceDelta: resourceDelta,
        activeResourceTypesAfterCleanup,
        activeResourceTypesBeforeSetup,
        redisClientClosed,
      },
      environment: {
        architecture: arch(),
        nodeVersion: process.version,
        operatingSystem: {
          platform: platform(),
          release: release(),
          type: operatingSystemType(),
        },
        package: metadata,
        redis: { image: request.redisImage, version: redisVersion(serverInformation) },
      },
      observations,
      phases,
      reproductionCommand: `pnpm --filter ${metadata.name} measure:resources --seed ${request.workload.seed}`,
      schemaVersion: RESOURCE_EVIDENCE_SCHEMA_VERSION,
      thresholdEvaluation: evaluateResourceThresholds(observations, request.thresholds),
      thresholds: request.thresholds,
      workload: request.workload,
    };
  } finally {
    if (!redisClientClosed) {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    }
  }
}

async function sendEvidence(evidence: ResourceRunEvidence): Promise<void> {
  if (!process.send) throw new Error("Resource measurement child requires an IPC channel");
  await new Promise<void>((resolve, reject) => {
    process.send?.(evidence, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function reportChildFailure(error: unknown): void {
  const failureMessage =
    error instanceof Error ? error.message : "Unknown resource measurement error";
  process.stderr.write(`Resource measurement child failed: ${failureMessage}\n`);
  process.exitCode = 1;
}

async function handleMeasurementMessage(requestMessage: unknown): Promise<void> {
  try {
    const evidence = await runMeasurement(parseResourceChildRequest(requestMessage));
    await sendEvidence(evidence);
  } catch (error) {
    reportChildFailure(error);
  } finally {
    process.disconnect();
  }
}

process.once("message", (requestMessage: unknown): void => {
  handleMeasurementMessage(requestMessage).catch(reportChildFailure);
});
