import { describe, expect, it } from "vitest";

import {
  parseResourceRunEvidence,
  type ResourceActivityEvidence,
  type ResourceRunEvidence,
  type ResourceSampleEvidence,
} from "../resource/evidence.ts";
import { evaluateResourceThresholds } from "../resource/thresholds.ts";

const sample: ResourceSampleEvidence = {
  activeResourceTypes: { PipeWrap: 1 },
  memory: {
    arrayBuffersAndBuffersBytes: 30,
    currentRssBytes: 50,
    externalBytes: 20,
    peakRssBytes: 60,
    v8HeapTotalBytes: 15,
    v8HeapUsedBytes: 10,
  },
};

const activity: ResourceActivityEvidence = {
  elapsedMilliseconds: 70,
  eventLoop: {
    activeMilliseconds: 4,
    delay: {
      maximumMilliseconds: 8,
      meanMilliseconds: 4,
      minimumMilliseconds: 1,
      p50Milliseconds: 3,
      p95Milliseconds: 7,
      p99Milliseconds: 8,
      sampleCount: 4,
    },
    idleMilliseconds: 6,
    utilization: 0.4,
  },
  peakMemory: sample.memory,
  systemCpuMilliseconds: 3,
  userCpuMilliseconds: 5,
};

function validEvidence(): ResourceRunEvidence {
  const observations = {
    activeResourceDeltaCount: 0,
    elapsedMilliseconds: 70,
    maxArrayBuffersAndBuffersBytes: 30,
    maxCurrentRssBytes: 50,
    maxEventLoopDelayP99Milliseconds: 8,
    maxEventLoopUtilization: 0.4,
    maxExternalBytes: 20,
    maxHeapUsedBytes: 10,
    maxPendingWritesAfterPhase: 0,
    peakConcurrencyPostGcRssRangeBytes: 0,
    peakRssBytes: 60,
    maxBufferedBytesAfterPhase: 0,
    maxCapacityShortfallBytesAfterPhase: 0,
    retainedArrayBuffersAndBuffersGrowthBytes: 0,
    retainedExternalGrowthBytes: 0,
    retainedHeapGrowthBytes: 0,
    systemCpuMilliseconds: 3,
    userCpuMilliseconds: 5,
  };
  const thresholds = {
    maxActiveResourceDeltaCount: 0,
    maxArrayBuffersAndBuffersBytes: 300,
    maxCurrentRssBytes: 500,
    maxElapsedMilliseconds: 700,
    maxEventLoopDelayP99Milliseconds: 80,
    maxEventLoopUtilization: 0.8,
    maxExternalBytes: 200,
    maxHeapUsedBytes: 100,
    maxPendingWritesAfterPhase: 0,
    maxPeakConcurrencyPostGcRssRangeBytes: 64,
    maxPeakRssBytes: 600,
    maxBufferedBytesAfterPhase: 0,
    maxCapacityShortfallBytesAfterPhase: 0,
    maxRetainedArrayBuffersAndBuffersGrowthBytes: 30,
    maxRetainedExternalGrowthBytes: 20,
    maxRetainedHeapGrowthBytes: 10,
    maxSystemCpuMilliseconds: 30,
    maxUserCpuMilliseconds: 50,
  };
  const measuredPhase = (
    name:
      | "buffer-limit-boundaries"
      | `peak-concurrency-run-${number}`
      | "cancelled-streams"
      | "invalidation-during-write"
      | "overlapping-writes"
      | "rejected-oversized-entries"
      | "steady-state-batch-1"
      | "upstream-stream-errors",
  ): ResourceRunEvidence["phases"][number] => ({
    activity,
    concurrency: name.startsWith("peak-concurrency-run-")
      ? {
          bufferedBytesAtPeak: 32,
          pendingWritesAtPeak: 8,
          run: 1,
        }
      : null,
    name,
    releaseCheck: {
      acceptedBufferedBytes: 16,
      bufferedBytesAfter: 0,
      pendingWritesAfter: 0,
    },
    samples: [sample],
  });
  return {
    cleanup: {
      activeResourceDelta: {},
      activeResourceTypesAfterCleanup: { PipeWrap: 1 },
      activeResourceTypesBeforeSetup: { PipeWrap: 1 },
      redisClientClosed: true,
    },
    environment: {
      architecture: "test-architecture",
      nodeVersion: "v24.21.0",
      operatingSystem: { platform: "test", release: "1", type: "Test" },
      package: { name: "unicorn-nextjs-memory-cache", version: "0.0.0" },
      redis: { image: "redis:test", version: "8.2.1" },
    },
    executionLimits: {
      failureDiagnostics: {
        enabled: false,
        maxDiagnosticReports: 1,
        maxHeapSnapshots: 1,
      },
      kernelLimits: {
        cpuQuotaCores: 0.5,
        memoryLimitBytes: 402_653_184,
        reason: "Kernel quotas are only available on Linux",
        status: "skipped",
        swapLimitBytes: 0,
      },
      redisMemoryLimitBytes: 134_217_728,
      timeoutMilliseconds: 60_000,
      v8OldSpaceLimitBytes: 268_435_456,
    },
    failureArtifacts: [],
    failureRerunCommand:
      "pnpm --filter unicorn-nextjs-memory-cache measure:resources --seed 1 --failure-diagnostics",
    limitExercise: {
      aggregate: [
        { attemptedBytes: 31, boundary: "below", outcome: "accepted", reason: null },
        { attemptedBytes: 32, boundary: "at", outcome: "accepted", reason: null },
        { attemptedBytes: 33, boundary: "above", outcome: "rejected", reason: "buffer-limit" },
      ],
      diagnostics: [
        { event: "entry-rejected", limitBytes: 8, observedBytes: 9, reason: "entry-size-limit" },
        { event: "entry-rejected", limitBytes: 32, observedBytes: 33, reason: "buffer-limit" },
      ],
      perEntry: [
        { attemptedBytes: 7, boundary: "below", outcome: "accepted", reason: null },
        { attemptedBytes: 8, boundary: "at", outcome: "accepted", reason: null },
        {
          attemptedBytes: 9,
          boundary: "above",
          outcome: "rejected",
          reason: "entry-size-limit",
        },
      ],
      previousValuesPreserved: true,
      reservationsReleased: true,
    },
    observations,
    phases: [
      {
        activity: null,
        concurrency: null,
        name: "post-warmup",
        releaseCheck: null,
        samples: [sample],
      },
      measuredPhase("steady-state-batch-1"),
      measuredPhase("buffer-limit-boundaries"),
      measuredPhase("peak-concurrency-run-1"),
      measuredPhase("rejected-oversized-entries"),
      measuredPhase("upstream-stream-errors"),
      measuredPhase("cancelled-streams"),
      measuredPhase("overlapping-writes"),
      measuredPhase("invalidation-during-write"),
      {
        activity: null,
        concurrency: null,
        name: "post-cleanup",
        releaseCheck: null,
        samples: [sample],
      },
    ],
    reproductionCommand: "pnpm --filter unicorn-nextjs-memory-cache measure:resources --seed 1",
    schemaVersion: 3,
    thresholdEvaluation: evaluateResourceThresholds(observations, thresholds),
    thresholds,
    workload: {
      chunkBytes: 1,
      concurrentStreamsPerBatch: 1,
      garbageCollectionPassesPerSample: 1,
      invalidationsPerBatch: 1,
      keyCount: 1,
      maxBufferedBytes: 16,
      maxEntrySizeBytes: 32,
      measurementBatches: 1,
      peakConcurrentStreams: 8,
      peakMaxBufferedBytes: 32,
      peakMaxEntrySizeBytes: 8,
      peakRuns: 1,
      readsPerBatch: 1,
      samplesPerPhase: 1,
      seed: 1,
      streamChunks: 1,
      tagCount: 1,
      warmupBatches: 1,
      writesPerBatch: 1,
    },
  };
}

describe("resource evidence verification", () => {
  it("accepts evidence whose lifecycle phases and threshold verdict are internally consistent", () => {
    const evidence = validEvidence();

    expect(parseResourceRunEvidence(evidence)).toBe(evidence);
  }, 1_000);

  it("rejects a child verdict that disagrees with coordinator-side threshold evaluation", () => {
    const evidence = validEvidence();
    const inconsistent = {
      ...evidence,
      observations: { ...evidence.observations, maxHeapUsedBytes: 101 },
    };

    expect(() => parseResourceRunEvidence(inconsistent)).toThrow(
      "Resource measurement child emitted malformed evidence",
    );
  }, 1_000);

  it("rejects boundary or concurrency claims that disagree with the requested workload", () => {
    const evidence = validEvidence();
    const incorrectBoundary = {
      ...evidence,
      limitExercise: {
        ...evidence.limitExercise,
        aggregate: [
          { attemptedBytes: 30, boundary: "below", outcome: "accepted", reason: null },
          ...evidence.limitExercise.aggregate.slice(1),
        ],
      },
    };
    const peakPhase = evidence.phases[3];
    if (!peakPhase) throw new Error("Expected a peak phase");
    const incorrectPeak = {
      ...evidence,
      phases: [
        ...evidence.phases.slice(0, 3),
        {
          ...peakPhase,
          concurrency: { bufferedBytesAtPeak: 31, pendingWritesAtPeak: 8, run: 1 },
        },
        ...evidence.phases.slice(4),
      ],
    };

    expect(() => parseResourceRunEvidence(incorrectBoundary)).toThrow(
      "Resource measurement child emitted malformed evidence",
    );
    expect(() => parseResourceRunEvidence(incorrectPeak)).toThrow(
      "Resource measurement child emitted malformed evidence",
    );
  }, 1_000);

  it("accepts exactly one report and heap snapshot only for an isolated diagnostic rerun", () => {
    const evidence = validEvidence();
    const diagnosticEvidence = {
      ...evidence,
      executionLimits: {
        ...evidence.executionLimits,
        failureDiagnostics: {
          ...evidence.executionLimits.failureDiagnostics,
          enabled: true,
        },
      },
      failureArtifacts: ["failure-report.json", "failure.heapsnapshot"],
    };

    expect(parseResourceRunEvidence(diagnosticEvidence)).toBe(diagnosticEvidence);
    expect(() =>
      parseResourceRunEvidence({ ...evidence, failureArtifacts: ["unexpected-report.json"] }),
    ).toThrow("Resource measurement child emitted malformed evidence");
    expect(() =>
      parseResourceRunEvidence({
        ...diagnosticEvidence,
        failureArtifacts: ["first.heapsnapshot", "second.heapsnapshot"],
      }),
    ).toThrow("Resource measurement child emitted malformed evidence");
  }, 1_000);

  it("preserves a failed verdict and phase evidence for retained handler bookkeeping", () => {
    const evidence = validEvidence();
    const steadyStatePhase = evidence.phases[1];
    if (!steadyStatePhase) throw new Error("Expected a measured phase");
    const inconsistent = {
      ...evidence,
      observations: {
        ...evidence.observations,
        maxBufferedBytesAfterPhase: 4,
        maxPendingWritesAfterPhase: 1,
      },
      phases: [
        evidence.phases[0],
        {
          ...steadyStatePhase,
          releaseCheck: {
            acceptedBufferedBytes: 16,
            bufferedBytesAfter: 4,
            pendingWritesAfter: 1,
          },
        },
        ...evidence.phases.slice(2),
      ],
    };
    const failedEvidence = {
      ...inconsistent,
      thresholdEvaluation: evaluateResourceThresholds(
        inconsistent.observations,
        inconsistent.thresholds,
      ),
    };

    expect(parseResourceRunEvidence(failedEvidence).thresholdEvaluation).toMatchObject({
      passed: false,
      violations: [
        { actual: 4, metric: "maxBufferedBytesAfterPhase", threshold: 0 },
        { actual: 1, metric: "maxPendingWritesAfterPhase", threshold: 0 },
      ],
    });
  }, 1_000);
});
