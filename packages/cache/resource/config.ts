import type { ResourceWorkloadParameters } from "./evidence.ts";
import type { ResourceThresholds } from "./thresholds.ts";

const MEBIBYTE = 1_024 * 1_024;

export const RESOURCE_REDIS_IMAGE = "redis:8.2.1-alpine";
export const RESOURCE_CHILD_TIMEOUT_MILLISECONDS = 60_000;

export const DEFAULT_RESOURCE_WORKLOAD: ResourceWorkloadParameters = {
  chunkBytes: 4 * 1_024,
  concurrentStreamsPerBatch: 4,
  garbageCollectionPassesPerSample: 2,
  invalidationsPerBatch: 4,
  keyCount: 12,
  maxBufferedBytes: 16 * 1_024,
  maxEntrySizeBytes: 20 * 1_024,
  measurementBatches: 3,
  readsPerBatch: 24,
  samplesPerPhase: 3,
  seed: 0x21ca_ce,
  streamChunks: 4,
  tagCount: 6,
  warmupBatches: 2,
  writesPerBatch: 12,
};

export const DEFAULT_RESOURCE_THRESHOLDS: ResourceThresholds = {
  maxActiveResourceDeltaCount: 0,
  maxArrayBuffersAndBuffersBytes: 128 * MEBIBYTE,
  maxCurrentRssBytes: 512 * MEBIBYTE,
  maxElapsedMilliseconds: 60_000,
  maxEventLoopDelayP99Milliseconds: 500,
  maxEventLoopUtilization: 1,
  maxExternalBytes: 256 * MEBIBYTE,
  maxHeapUsedBytes: 256 * MEBIBYTE,
  maxPendingWritesAfterPhase: 0,
  maxPeakRssBytes: 640 * MEBIBYTE,
  maxBufferedBytesAfterPhase: 0,
  maxCapacityShortfallBytesAfterPhase: 0,
  maxRetainedArrayBuffersAndBuffersGrowthBytes: 1 * MEBIBYTE,
  maxRetainedExternalGrowthBytes: 1 * MEBIBYTE,
  maxRetainedHeapGrowthBytes: 4 * MEBIBYTE,
  maxSystemCpuMilliseconds: 30_000,
  maxUserCpuMilliseconds: 60_000,
};
