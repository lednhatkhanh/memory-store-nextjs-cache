import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { arch, platform, release, type as operatingSystemType } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setImmediate as yieldToEventLoop, setTimeout as delay } from "node:timers/promises";
import { writeHeapSnapshot } from "node:v8";

import { Redis } from "ioredis";

import {
  RESOURCE_EVIDENCE_SCHEMA_VERSION,
  type EventLoopDelayEvidence,
  type ResourceActivityEvidence,
  type ResourceConcurrencyEvidence,
  type ResourceLimitExerciseEvidence,
  type ResourceLimitOutcomeEvidence,
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
type MeasurementCacheNamespace = Readonly<{ deployment: string; release: string }>;
type MeasurementDiagnostic = Readonly<{
  event: "entry-rejected";
  limitBytes: number;
  observedBytes: number;
  reason: "buffer-limit" | "entry-size-limit";
}>;
type MeasurementRedisCacheHandler = Readonly<{
  get: (cacheKey: string, softTags: string[]) => Promise<MeasurementCacheEntry | undefined>;
  getResourceState: () => MeasurementResourceState;
  set: (cacheKey: string, pendingEntry: Promise<MeasurementCacheEntry>) => Promise<void>;
  updateTags: (tags: string[], durations?: { expire?: number }) => Promise<void>;
}>;
type ProductionPackage = Readonly<{
  createCacheNamespace: (input: {
    application: string;
    environment: string;
    locale: string;
    release: string;
    site: string;
  }) => MeasurementCacheNamespace;
  createRedisCacheHandler: (
    client: Redis,
    options: Readonly<{
      maxBufferedBytes: number;
      maxEntrySizeBytes: number;
      namespace: MeasurementCacheNamespace;
      onDiagnostic?: (diagnostic: MeasurementDiagnostic) => void;
    }>,
  ) => MeasurementRedisCacheHandler;
  packageIdentity: string;
}>;
type HeldPayload = Readonly<{
  buffered: Promise<true>;
  release: () => void;
  stream: ReadableStream<Uint8Array>;
}>;
type PhaseRunEvidence = Readonly<{
  concurrency: ResourceConcurrencyEvidence | null;
  releaseCheck: ResourceReleaseCheckEvidence;
}>;

function isProductionPackage(value: unknown): value is ProductionPackage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "packageIdentity") === "string" &&
    typeof Reflect.get(value, "createCacheNamespace") === "function" &&
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

function captureMemory(): ResourceSampleEvidence["memory"] {
  const memory = process.memoryUsage();
  return {
    arrayBuffersAndBuffersBytes: memory.arrayBuffers,
    currentRssBytes: memory.rss,
    externalBytes: memory.external,
    peakRssBytes: process.resourceUsage().maxRSS * 1_024,
    v8HeapTotalBytes: memory.heapTotal,
    v8HeapUsedBytes: memory.heapUsed,
  };
}

function maximumMemory(
  left: ResourceSampleEvidence["memory"],
  right: ResourceSampleEvidence["memory"],
): ResourceSampleEvidence["memory"] {
  return {
    arrayBuffersAndBuffersBytes: Math.max(
      left.arrayBuffersAndBuffersBytes,
      right.arrayBuffersAndBuffersBytes,
    ),
    currentRssBytes: Math.max(left.currentRssBytes, right.currentRssBytes),
    externalBytes: Math.max(left.externalBytes, right.externalBytes),
    peakRssBytes: Math.max(left.peakRssBytes, right.peakRssBytes),
    v8HeapTotalBytes: Math.max(left.v8HeapTotalBytes, right.v8HeapTotalBytes),
    v8HeapUsedBytes: Math.max(left.v8HeapUsedBytes, right.v8HeapUsedBytes),
  };
}

function trackPeakMemory(): Readonly<{
  stop: () => ResourceSampleEvidence["memory"];
}> {
  let peak = captureMemory();
  const timer = setInterval(() => {
    peak = maximumMemory(peak, captureMemory());
  }, 1);
  return {
    stop() {
      clearInterval(timer);
      peak = maximumMemory(peak, captureMemory());
      return peak;
    },
  };
}

async function captureSamples(
  workload: ResourceWorkloadParameters,
): Promise<ResourceSampleEvidence[]> {
  const samples: ResourceSampleEvidence[] = [];
  for (let index = 0; index < workload.samplesPerPhase; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Comparable samples use identical GC stabilization.
    await stabilizeGarbageCollection(workload.garbageCollectionPassesPerSample);
    samples.push({
      activeResourceTypes: activeResourceTypes(),
      memory: captureMemory(),
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
  run: () => Promise<PhaseRunEvidence>,
): Promise<ResourcePhaseEvidence> {
  await stabilizeGarbageCollection(workload.garbageCollectionPassesPerSample);
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  await yieldToEventLoop();
  histogram.reset();
  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const startedEventLoop = performance.eventLoopUtilization();
  const memoryTracker = trackPeakMemory();
  let activity: ResourceActivityEvidence | undefined;
  let peakMemory: ResourceSampleEvidence["memory"] | undefined;
  let phaseRun: PhaseRunEvidence | undefined;

  try {
    phaseRun = await run();
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
      peakMemory: (peakMemory = memoryTracker.stop()),
      systemCpuMilliseconds: cpu.system / 1_000,
      userCpuMilliseconds: cpu.user / 1_000,
    };
  } finally {
    histogram.disable();
    if (!peakMemory) memoryTracker.stop();
  }
  if (!activity || !phaseRun) throw new Error(`Resource phase ${name} did not record evidence`);
  const samples = await captureSamples(workload);
  return {
    activity,
    concurrency: phaseRun.concurrency,
    name,
    releaseCheck: phaseRun.releaseCheck,
    samples,
  };
}

async function captureLifecyclePhase(
  name: ResourceLifecyclePhaseName,
  workload: ResourceWorkloadParameters,
  transition: () => Promise<void>,
): Promise<ResourcePhaseEvidence> {
  await transition();
  const samples = await captureSamples(workload);
  return { activity: null, concurrency: null, name, releaseCheck: null, samples };
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

function streamedPayloadBytes(
  random: SeededRandom,
  totalBytes: number,
  chunkBytes: number,
): ReadableStream<Uint8Array> {
  const byte = Math.floor(random() * 256);
  let emittedBytes = 0;
  return new ReadableStream({
    async pull(controller) {
      await yieldToEventLoop();
      if (emittedBytes === totalBytes) {
        controller.close();
        return;
      }
      const length = Math.min(chunkBytes, totalBytes - emittedBytes);
      const chunk = new Uint8Array(length);
      chunk.fill(byte);
      emittedBytes += length;
      controller.enqueue(chunk);
    },
  });
}

function entryMetadataBytes(tags: string[], timestamp: number): number {
  return Buffer.byteLength(
    JSON.stringify({ expire: 3_600, revalidate: 300, stale: 60, tags, timestamp }),
  );
}

function limitOutcome(
  attemptedBytes: number,
  boundary: ResourceLimitOutcomeEvidence["boundary"],
  reason: ResourceLimitOutcomeEvidence["reason"],
): ResourceLimitOutcomeEvidence {
  return {
    attemptedBytes,
    boundary,
    outcome: boundary === "above" ? "rejected" : "accepted",
    reason,
  };
}

async function readEntryFingerprint(
  handler: MeasurementRedisCacheHandler,
  cacheKey: string,
): Promise<string> {
  const entry = await handler.get(cacheKey, []);
  if (!entry) throw new Error(`Expected a completed entry for ${cacheKey}`);
  const payload = await new Response(entry.value).arrayBuffer();
  return createHash("sha256")
    .update(
      JSON.stringify({
        expire: entry.expire,
        revalidate: entry.revalidate,
        stale: entry.stale,
        tags: entry.tags,
        timestamp: entry.timestamp,
      }),
    )
    .update(new Uint8Array(payload))
    .digest("hex");
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

async function runPerEntryBoundaries(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
): Promise<
  Readonly<{ outcomes: ResourceLimitOutcomeEvidence[]; previousValuePreserved: boolean }>
> {
  const cacheKey = "resource-per-entry-boundary";
  const chunkBytes = Math.min(workload.peakMaxEntrySizeBytes, 1_024 * 1_024);
  const outcomes: ResourceLimitOutcomeEvidence[] = [];

  for (const [boundary, difference] of [
    ["below", -1],
    ["at", 0],
  ] as const) {
    const timestamp = nextTimestamp();
    const payloadBytes =
      workload.peakMaxEntrySizeBytes - entryMetadataBytes([], timestamp) + difference;
    if (payloadBytes <= 0) throw new Error("Peak per-entry limit cannot contain cache metadata");
    // oxlint-disable-next-line no-await-in-loop -- Boundary cases settle independently.
    await handler.set(
      cacheKey,
      Promise.resolve(
        createEntry(streamedPayloadBytes(random, payloadBytes, chunkBytes), [], timestamp),
      ),
    );
    outcomes.push(limitOutcome(workload.peakMaxEntrySizeBytes + difference, boundary, null));
  }

  const preservedFingerprint = await readEntryFingerprint(handler, cacheKey);
  const rejectedTimestamp = nextTimestamp();
  const rejectedPayloadBytes =
    workload.peakMaxEntrySizeBytes - entryMetadataBytes([], rejectedTimestamp) + 1;
  await expectRejection(
    handler.set(
      cacheKey,
      Promise.resolve(
        createEntry(
          streamedPayloadBytes(random, rejectedPayloadBytes, chunkBytes),
          [],
          rejectedTimestamp,
        ),
      ),
    ),
    "Redis cache entry rejected: entry-size-limit",
  );
  outcomes.push(limitOutcome(workload.peakMaxEntrySizeBytes + 1, "above", "entry-size-limit"));
  return {
    outcomes,
    previousValuePreserved:
      (await readEntryFingerprint(handler, cacheKey)) === preservedFingerprint,
  };
}

function distributedByteCounts(totalBytes: number, streamCount: number): number[] {
  const quotient = Math.floor(totalBytes / streamCount);
  const remainder = totalBytes % streamCount;
  return Array.from({ length: streamCount }, (_, index) => quotient + (index < remainder ? 1 : 0));
}

async function holdConcurrentPayloads(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  nextTimestamp: () => number,
  prefix: string,
  byteCounts: number[],
): Promise<
  Readonly<{
    payloads: HeldPayload[];
    writes: Array<Promise<void>>;
  }>
> {
  const payloads = byteCounts.map((byteCount) =>
    heldPayload(byteCount, Math.floor(random() * 256)),
  );
  const writes = payloads.map(
    async (payload, index) =>
      await handler.set(
        `${prefix}-${index}`,
        Promise.resolve(createEntry(payload.stream, [], nextTimestamp())),
      ),
  );
  await Promise.all(payloads.map(async (payload) => payload.buffered));
  return { payloads, writes };
}

async function releaseConcurrentPayloads(
  payloads: HeldPayload[],
  writes: Array<Promise<void>>,
): Promise<void> {
  for (const payload of payloads) payload.release();
  await Promise.all(writes);
}

function timestampGenerator(): () => number {
  let previous = 0;
  return () => {
    const current = performance.timeOrigin + performance.now();
    previous = Math.max(current, previous + 0.001);
    return previous;
  };
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
): Promise<PhaseRunEvidence> {
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
    concurrency: null,
    releaseCheck: {
      acceptedBufferedBytes,
      bufferedBytesAfter: Math.max(afterPhase.bufferedBytes, afterProbe.bufferedBytes),
      pendingWritesAfter: Math.max(afterPhase.pendingWrites, afterProbe.pendingWrites),
    },
  };
}

async function runBufferLimitBoundaries(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
  diagnostics: MeasurementDiagnostic[],
): Promise<Readonly<{ limitExercise: ResourceLimitExerciseEvidence; phase: PhaseRunEvidence }>> {
  const perEntry = await runPerEntryBoundaries(handler, random, workload, nextTimestamp);
  const aggregateOutcomes: ResourceLimitOutcomeEvidence[] = [];
  const below = await holdConcurrentPayloads(
    handler,
    random,
    nextTimestamp,
    "resource-aggregate-slot",
    distributedByteCounts(workload.peakMaxBufferedBytes - 1, workload.peakConcurrentStreams),
  );
  const belowState = handler.getResourceState();
  if (belowState.bufferedBytes !== workload.peakMaxBufferedBytes - 1) {
    throw new Error("Below-limit aggregate workload did not reserve the expected bytes");
  }
  aggregateOutcomes.push(limitOutcome(workload.peakMaxBufferedBytes - 1, "below", null));
  await releaseConcurrentPayloads(below.payloads, below.writes);

  const protectedKey = "resource-aggregate-overflow";
  await handler.set(
    protectedKey,
    Promise.resolve(createEntry(streamedPayloadBytes(random, 1, 1), [], nextTimestamp())),
  );
  const previousFingerprint = await readEntryFingerprint(handler, protectedKey);
  const at = await holdConcurrentPayloads(
    handler,
    random,
    nextTimestamp,
    "resource-aggregate-slot",
    distributedByteCounts(workload.peakMaxBufferedBytes, workload.peakConcurrentStreams),
  );
  const atState = handler.getResourceState();
  if (
    atState.bufferedBytes !== workload.peakMaxBufferedBytes ||
    atState.pendingWrites !== workload.peakConcurrentStreams
  ) {
    throw new Error("At-limit aggregate workload did not reach the configured concurrency peak");
  }
  aggregateOutcomes.push(limitOutcome(workload.peakMaxBufferedBytes, "at", null));
  await delay(5);
  await expectRejection(
    handler.set(
      protectedKey,
      Promise.resolve(createEntry(streamedPayloadBytes(random, 1, 1), [], nextTimestamp())),
    ),
    "Redis cache entry rejected: buffer-limit",
  );
  aggregateOutcomes.push(limitOutcome(workload.peakMaxBufferedBytes + 1, "above", "buffer-limit"));
  const previousValuePreserved =
    perEntry.previousValuePreserved &&
    (await readEntryFingerprint(handler, protectedKey)) === previousFingerprint;
  await releaseConcurrentPayloads(at.payloads, at.writes);
  const after = handler.getResourceState();
  const entryDiagnostic = diagnostics.find(
    (diagnostic) => diagnostic.reason === "entry-size-limit",
  );
  const bufferDiagnostic = diagnostics.find((diagnostic) => diagnostic.reason === "buffer-limit");
  if (!entryDiagnostic || !bufferDiagnostic) {
    throw new Error("Boundary workload did not emit both bounded rejection diagnostics");
  }

  return {
    limitExercise: {
      aggregate: aggregateOutcomes,
      diagnostics: [entryDiagnostic, bufferDiagnostic],
      perEntry: perEntry.outcomes,
      previousValuesPreserved: previousValuePreserved,
      reservationsReleased: after.bufferedBytes === 0 && after.pendingWrites === 0,
    },
    phase: {
      concurrency: null,
      releaseCheck: {
        acceptedBufferedBytes: atState.bufferedBytes,
        bufferedBytesAfter: after.bufferedBytes,
        pendingWritesAfter: after.pendingWrites,
      },
    },
  };
}

async function runPeakConcurrency(
  handler: MeasurementRedisCacheHandler,
  random: SeededRandom,
  workload: ResourceWorkloadParameters,
  nextTimestamp: () => number,
  run: number,
  captureAtPeak?: () => Promise<void>,
): Promise<PhaseRunEvidence> {
  const held = await holdConcurrentPayloads(
    handler,
    random,
    nextTimestamp,
    "resource-aggregate-slot",
    distributedByteCounts(workload.peakMaxBufferedBytes, workload.peakConcurrentStreams),
  );
  const atPeak = handler.getResourceState();
  if (
    atPeak.bufferedBytes !== workload.peakMaxBufferedBytes ||
    atPeak.pendingWrites !== workload.peakConcurrentStreams
  ) {
    throw new Error(`Peak concurrency run ${run} did not reach the configured limits`);
  }
  await delay(5);
  if (captureAtPeak) await captureAtPeak();
  await releaseConcurrentPayloads(held.payloads, held.writes);
  const after = handler.getResourceState();
  return {
    concurrency: {
      bufferedBytesAtPeak: atPeak.bufferedBytes,
      pendingWritesAtPeak: atPeak.pendingWrites,
      run,
    },
    releaseCheck: {
      acceptedBufferedBytes: atPeak.bufferedBytes,
      bufferedBytesAfter: after.bufferedBytes,
      pendingWritesAfter: after.pendingWrites,
    },
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

function peakConcurrencyPostGcRssRange(phases: ResourcePhaseEvidence[]): number {
  const stabilizedRss = phases
    .filter((phase) => phase.name.startsWith("peak-concurrency-run-"))
    .map((phase) => median(phase.samples.map((sample) => sample.memory.currentRssBytes)));
  if (stabilizedRss.length === 0) {
    throw new Error("Resource measurement did not record peak-concurrency samples");
  }
  return Math.max(...stabilizedRss) - Math.min(...stabilizedRss);
}

function summarizeObservations(
  phases: ResourcePhaseEvidence[],
  resourceDelta: Readonly<Record<string, number>>,
  workload: ResourceWorkloadParameters,
): ResourceObservations {
  const samples = phases.flatMap((phase) => phase.samples);
  const activities = phases.flatMap((phase) => (phase.activity ? [phase.activity] : []));
  const peakMemory = [
    ...samples.map((sample) => sample.memory),
    ...activities.map((activity) => activity.peakMemory),
  ];
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
      ...peakMemory.map((memory) => memory.arrayBuffersAndBuffersBytes),
    ),
    maxBufferedBytesAfterPhase: Math.max(
      ...releaseChecks.map((releaseCheck) => releaseCheck.bufferedBytesAfter),
    ),
    maxCapacityShortfallBytesAfterPhase: Math.max(
      ...releaseChecks.map((releaseCheck) =>
        Math.max(0, workload.maxBufferedBytes - releaseCheck.acceptedBufferedBytes),
      ),
    ),
    maxCurrentRssBytes: Math.max(...peakMemory.map((memory) => memory.currentRssBytes)),
    maxEventLoopDelayP99Milliseconds: Math.max(
      ...activities.map((activity) => activity.eventLoop.delay.p99Milliseconds),
    ),
    maxEventLoopUtilization: Math.max(
      ...activities.map((activity) => activity.eventLoop.utilization),
    ),
    maxExternalBytes: Math.max(...peakMemory.map((memory) => memory.externalBytes)),
    maxHeapUsedBytes: Math.max(...peakMemory.map((memory) => memory.v8HeapUsedBytes)),
    maxPendingWritesAfterPhase: Math.max(
      ...releaseChecks.map((releaseCheck) => releaseCheck.pendingWritesAfter),
    ),
    peakConcurrencyPostGcRssRangeBytes: peakConcurrencyPostGcRssRange(phases),
    peakRssBytes: Math.max(...peakMemory.map((memory) => memory.peakRssBytes)),
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

async function captureFailureArtifacts(directory: string): Promise<string[]> {
  const diagnosticReportName = "cache-resource-failure-report.json";
  const diagnosticReport = path.join(directory, diagnosticReportName);
  const heapSnapshotName = "cache-resource-failure.heapsnapshot";
  const heapSnapshot = path.join(directory, heapSnapshotName);
  process.report.writeReport(diagnosticReportName);
  const artifacts = [diagnosticReport, writeHeapSnapshot(heapSnapshot)];
  const directoryEntries = (await readdir(directory)).toSorted();
  const expectedEntries = [diagnosticReportName, heapSnapshotName].toSorted();
  if (
    directoryEntries.length !== expectedEntries.length ||
    directoryEntries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    throw new Error("Failure diagnostic retention exceeded its configured bounds");
  }
  const artifactStats = await Promise.all(artifacts.map(async (artifact) => stat(artifact)));
  if (artifactStats.some((artifactStat) => !artifactStat.isFile() || artifactStat.size === 0)) {
    throw new Error("Failure diagnostics did not produce both bounded artifacts");
  }
  return artifacts;
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
  const diagnostics: MeasurementDiagnostic[] = [];
  let failureArtifacts: string[] = [];
  let limitExercise: ResourceLimitExerciseEvidence | undefined;
  const handler = productionPackage.createRedisCacheHandler(redis, {
    maxBufferedBytes: request.workload.maxBufferedBytes,
    maxEntrySizeBytes: request.workload.maxEntrySizeBytes,
    namespace: productionPackage.createCacheNamespace({
      application: "resource-measurement",
      environment: "test",
      locale: "en",
      release: `seed-${request.workload.seed}`,
      site: "steady-state",
    }),
  });
  const peakHandler = productionPackage.createRedisCacheHandler(redis, {
    maxBufferedBytes: request.workload.peakMaxBufferedBytes,
    maxEntrySizeBytes: request.workload.peakMaxEntrySizeBytes,
    namespace: productionPackage.createCacheNamespace({
      application: "resource-measurement",
      environment: "test",
      locale: "en",
      release: `seed-${request.workload.seed}`,
      site: "peak",
    }),
    onDiagnostic(diagnostic) {
      diagnostics.push(diagnostic);
    },
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

    phases.push(
      await measureWorkloadPhase("buffer-limit-boundaries", request.workload, async () => {
        const result = await runBufferLimitBoundaries(
          peakHandler,
          random,
          request.workload,
          nextTimestamp,
          diagnostics,
        );
        limitExercise = result.limitExercise;
        return result.phase;
      }),
    );

    const failureDiagnosticsDirectory = request.failureDiagnosticsDirectory;
    for (let run = 1; run <= request.workload.peakRuns; run += 1) {
      const name = `peak-concurrency-run-${run}` as const;
      let captureAtPeak: (() => Promise<void>) | undefined;
      if (run === 1 && failureDiagnosticsDirectory) {
        captureAtPeak = async (): Promise<void> => {
          failureArtifacts = await captureFailureArtifacts(failureDiagnosticsDirectory);
        };
      }
      // oxlint-disable-next-line no-await-in-loop -- Each peak run must settle before comparison.
      const phase = await measureWorkloadPhase(name, request.workload, async () =>
        runPeakConcurrency(
          peakHandler,
          random,
          request.workload,
          nextTimestamp,
          run,
          captureAtPeak,
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
    if (!limitExercise) throw new Error("Resource measurement did not record limit exercises");
    const thresholdEvaluation = evaluateResourceThresholds(observations, request.thresholds);
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
      executionLimits: request.executionLimits,
      failureArtifacts,
      failureRerunCommand: `pnpm --filter ${metadata.name} measure:resources --seed ${request.workload.seed} --failure-diagnostics`,
      limitExercise,
      observations,
      phases,
      reproductionCommand: `pnpm --filter ${metadata.name} measure:resources --seed ${request.workload.seed}`,
      schemaVersion: RESOURCE_EVIDENCE_SCHEMA_VERSION,
      thresholdEvaluation,
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
