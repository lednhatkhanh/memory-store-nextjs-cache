import type { ResourceWorkloadParameters } from "./evidence.ts";
import type { ResourceThresholds } from "./thresholds.ts";

const MEBIBYTE = 1_024 * 1_024;

export const RESOURCE_REDIS_IMAGE = "redis:8.2.1-alpine";
export const RESOURCE_CHILD_TIMEOUT_MILLISECONDS = 60_000;
export const RESOURCE_CPU_QUOTA_CORES = 0.5;
export const RESOURCE_KERNEL_MEMORY_LIMIT_BYTES = 768 * MEBIBYTE;
export const RESOURCE_KERNEL_SWAP_LIMIT_BYTES = 0;
export const RESOURCE_REDIS_MEMORY_LIMIT_BYTES = 128 * MEBIBYTE;
export const RESOURCE_V8_OLD_SPACE_LIMIT_BYTES = 256 * MEBIBYTE;

export const DEFAULT_RESOURCE_WORKLOAD: ResourceWorkloadParameters = {
  chunkBytes: 4 * 1_024,
  concurrentStreamsPerBatch: 4,
  garbageCollectionPassesPerSample: 2,
  invalidationsPerBatch: 4,
  keyCount: 12,
  maxBufferedBytes: 16 * 1_024,
  maxEntrySizeBytes: 20 * 1_024,
  measurementBatches: 3,
  peakConcurrentStreams: 8,
  peakMaxBufferedBytes: 32 * MEBIBYTE,
  peakMaxEntrySizeBytes: 8 * MEBIBYTE,
  peakRuns: 3,
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
  maxArrayBuffersAndBuffersBytes: 192 * MEBIBYTE,
  maxCurrentRssBytes: 640 * MEBIBYTE,
  maxElapsedMilliseconds: 60_000,
  maxEventLoopDelayP99Milliseconds: 500,
  maxEventLoopUtilization: 1,
  maxExternalBytes: 192 * MEBIBYTE,
  maxHeapUsedBytes: 192 * MEBIBYTE,
  maxPendingWritesAfterPhase: 0,
  maxPeakConcurrencyPostGcRssRangeBytes: 96 * MEBIBYTE,
  maxPeakRssBytes: 640 * MEBIBYTE,
  maxBufferedBytesAfterPhase: 0,
  maxCapacityShortfallBytesAfterPhase: 0,
  maxRetainedArrayBuffersAndBuffersGrowthBytes: 1 * MEBIBYTE,
  maxRetainedExternalGrowthBytes: 1 * MEBIBYTE,
  maxRetainedHeapGrowthBytes: 4 * MEBIBYTE,
  maxSystemCpuMilliseconds: 30_000,
  maxUserCpuMilliseconds: 60_000,
};
