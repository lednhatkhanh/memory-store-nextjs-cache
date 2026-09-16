import { isNumber, isString } from "es-toolkit";

import {
  evaluateResourceThresholds,
  isResourceObservations,
  isResourceThresholdEvaluation,
  isResourceThresholds,
  type ResourceObservations,
  type ResourceThresholdEvaluation,
  type ResourceThresholds,
} from "./thresholds.ts";
import { isRecord } from "./validation.ts";

export const RESOURCE_EVIDENCE_SCHEMA_VERSION = 2;

export type ResourceWorkloadParameters = Readonly<{
  chunkBytes: number;
  concurrentStreamsPerBatch: number;
  garbageCollectionPassesPerSample: number;
  invalidationsPerBatch: number;
  keyCount: number;
  maxBufferedBytes: number;
  maxEntrySizeBytes: number;
  measurementBatches: number;
  readsPerBatch: number;
  samplesPerPhase: number;
  seed: number;
  streamChunks: number;
  tagCount: number;
  warmupBatches: number;
  writesPerBatch: number;
}>;

export type ResourceMemoryEvidence = Readonly<{
  arrayBuffersAndBuffersBytes: number;
  currentRssBytes: number;
  externalBytes: number;
  peakRssBytes: number;
  v8HeapTotalBytes: number;
  v8HeapUsedBytes: number;
}>;

export type EventLoopDelayEvidence = Readonly<{
  maximumMilliseconds: number;
  meanMilliseconds: number;
  minimumMilliseconds: number;
  p50Milliseconds: number;
  p95Milliseconds: number;
  p99Milliseconds: number;
  sampleCount: number;
}>;

export type ResourceActivityEvidence = Readonly<{
  elapsedMilliseconds: number;
  eventLoop: Readonly<{
    activeMilliseconds: number;
    delay: EventLoopDelayEvidence;
    idleMilliseconds: number;
    utilization: number;
  }>;
  systemCpuMilliseconds: number;
  userCpuMilliseconds: number;
}>;

export type ResourceSampleEvidence = Readonly<{
  activeResourceTypes: Readonly<Record<string, number>>;
  memory: ResourceMemoryEvidence;
}>;

export type ResourceReleaseCheckEvidence = Readonly<{
  acceptedBufferedBytes: number;
  bufferedBytesAfter: number;
  pendingWritesAfter: number;
}>;

export type ResourceLifecyclePhaseName = "post-cleanup" | "post-warmup";
export type ResourceMeasurementPhaseName =
  | "cancelled-streams"
  | "invalidation-during-write"
  | "overlapping-writes"
  | "rejected-oversized-entries"
  | "upstream-stream-errors"
  | `steady-state-batch-${number}`;
export type ResourcePhaseName = ResourceLifecyclePhaseName | ResourceMeasurementPhaseName;

export type ResourcePhaseEvidence = Readonly<{
  activity: ResourceActivityEvidence | null;
  name: ResourcePhaseName;
  releaseCheck: ResourceReleaseCheckEvidence | null;
  samples: ResourceSampleEvidence[];
}>;

export type ResourceEnvironmentEvidence = Readonly<{
  architecture: string;
  nodeVersion: string;
  operatingSystem: Readonly<{
    platform: string;
    release: string;
    type: string;
  }>;
  package: Readonly<{
    name: string;
    version: string;
  }>;
  redis: Readonly<{
    image: string;
    version: string;
  }>;
}>;

export type ResourceRunEvidence = Readonly<{
  cleanup: Readonly<{
    activeResourceDelta: Readonly<Record<string, number>>;
    activeResourceTypesAfterCleanup: Readonly<Record<string, number>>;
    activeResourceTypesBeforeSetup: Readonly<Record<string, number>>;
    redisClientClosed: boolean;
  }>;
  environment: ResourceEnvironmentEvidence;
  observations: ResourceObservations;
  phases: ResourcePhaseEvidence[];
  reproductionCommand: string;
  schemaVersion: typeof RESOURCE_EVIDENCE_SCHEMA_VERSION;
  thresholdEvaluation: ResourceThresholdEvaluation;
  thresholds: ResourceThresholds;
  workload: ResourceWorkloadParameters;
}>;

function hasFiniteNumber(record: Record<string, unknown>, property: string): boolean {
  const value = record[property];
  return isNumber(value) && Number.isFinite(value) && value >= 0;
}

function hasString(record: Record<string, unknown>, property: string): boolean {
  return isString(record[property]);
}

function isFiniteNumberRecord(value: unknown): value is Readonly<Record<string, number>> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isNumber(item) && Number.isSafeInteger(item) && item >= 0)
  );
}

export function isResourceWorkloadParameters(value: unknown): value is ResourceWorkloadParameters {
  if (!isRecord(value)) return false;
  const positiveProperties = [
    "chunkBytes",
    "concurrentStreamsPerBatch",
    "garbageCollectionPassesPerSample",
    "invalidationsPerBatch",
    "keyCount",
    "maxBufferedBytes",
    "maxEntrySizeBytes",
    "measurementBatches",
    "readsPerBatch",
    "samplesPerPhase",
    "streamChunks",
    "tagCount",
    "warmupBatches",
    "writesPerBatch",
  ];
  return (
    positiveProperties.every(
      (property) =>
        typeof value[property] === "number" &&
        Number.isSafeInteger(value[property]) &&
        value[property] > 0,
    ) &&
    typeof value["seed"] === "number" &&
    Number.isSafeInteger(value["seed"]) &&
    value["seed"] >= 0
  );
}

function isResourceSample(value: unknown): value is ResourceSampleEvidence {
  if (
    !isRecord(value) ||
    !isRecord(value["memory"]) ||
    !isFiniteNumberRecord(value["activeResourceTypes"])
  ) {
    return false;
  }
  const memory = value["memory"];
  return [
    "arrayBuffersAndBuffersBytes",
    "currentRssBytes",
    "externalBytes",
    "peakRssBytes",
    "v8HeapTotalBytes",
    "v8HeapUsedBytes",
  ].every((property) => hasFiniteNumber(memory, property));
}

function isEventLoopDelay(value: unknown): value is EventLoopDelayEvidence {
  if (!isRecord(value)) return false;
  return [
    "maximumMilliseconds",
    "meanMilliseconds",
    "minimumMilliseconds",
    "p50Milliseconds",
    "p95Milliseconds",
    "p99Milliseconds",
    "sampleCount",
  ].every((property) => hasFiniteNumber(value, property));
}

function isResourceActivity(value: unknown): value is ResourceActivityEvidence {
  return (
    isRecord(value) &&
    hasFiniteNumber(value, "elapsedMilliseconds") &&
    hasFiniteNumber(value, "systemCpuMilliseconds") &&
    hasFiniteNumber(value, "userCpuMilliseconds") &&
    isRecord(value["eventLoop"]) &&
    hasFiniteNumber(value["eventLoop"], "activeMilliseconds") &&
    hasFiniteNumber(value["eventLoop"], "idleMilliseconds") &&
    hasFiniteNumber(value["eventLoop"], "utilization") &&
    isEventLoopDelay(value["eventLoop"]["delay"])
  );
}

function isResourcePhaseName(value: unknown): value is ResourcePhaseName {
  return (
    value === "post-cleanup" ||
    value === "post-warmup" ||
    value === "cancelled-streams" ||
    value === "invalidation-during-write" ||
    value === "overlapping-writes" ||
    value === "rejected-oversized-entries" ||
    value === "upstream-stream-errors" ||
    (typeof value === "string" && /^steady-state-batch-[1-9]\d*$/u.test(value))
  );
}

function isResourcePhase(value: unknown): value is ResourcePhaseEvidence {
  const releaseCheck = isRecord(value) ? value["releaseCheck"] : null;
  return (
    isRecord(value) &&
    isResourcePhaseName(value["name"]) &&
    (value["activity"] === null || isResourceActivity(value["activity"])) &&
    (releaseCheck === null ||
      (isRecord(releaseCheck) &&
        hasFiniteNumber(releaseCheck, "acceptedBufferedBytes") &&
        hasFiniteNumber(releaseCheck, "bufferedBytesAfter") &&
        hasFiniteNumber(releaseCheck, "pendingWritesAfter"))) &&
    Array.isArray(value["samples"]) &&
    value["samples"].length > 0 &&
    value["samples"].every(isResourceSample)
  );
}

function isEnvironment(value: unknown): value is ResourceEnvironmentEvidence {
  return (
    isRecord(value) &&
    hasString(value, "architecture") &&
    hasString(value, "nodeVersion") &&
    isRecord(value["operatingSystem"]) &&
    hasString(value["operatingSystem"], "platform") &&
    hasString(value["operatingSystem"], "release") &&
    hasString(value["operatingSystem"], "type") &&
    isRecord(value["package"]) &&
    hasString(value["package"], "name") &&
    hasString(value["package"], "version") &&
    isRecord(value["redis"]) &&
    hasString(value["redis"], "image") &&
    hasString(value["redis"], "version")
  );
}

function isIntegerRecord(value: unknown): value is Readonly<Record<string, number>> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isNumber(item) && Number.isSafeInteger(item))
  );
}

function isCleanup(value: unknown): value is ResourceRunEvidence["cleanup"] {
  return (
    isRecord(value) &&
    value["redisClientClosed"] === true &&
    isFiniteNumberRecord(value["activeResourceTypesAfterCleanup"]) &&
    isFiniteNumberRecord(value["activeResourceTypesBeforeSetup"]) &&
    isIntegerRecord(value["activeResourceDelta"])
  );
}

function thresholdEvaluationsMatch(
  actual: ResourceThresholdEvaluation,
  expected: ResourceThresholdEvaluation,
): boolean {
  return (
    actual.passed === expected.passed &&
    actual.violations.length === expected.violations.length &&
    actual.violations.every((violation, index) => {
      const expectedViolation = expected.violations[index];
      if (!expectedViolation) return false;
      return (
        violation.actual === expectedViolation.actual &&
        violation.metric === expectedViolation.metric &&
        violation.threshold === expectedViolation.threshold
      );
    })
  );
}

function hasExpectedPhaseShape(
  phases: ResourcePhaseEvidence[],
  workload: ResourceWorkloadParameters,
): boolean {
  const churnPhaseNames: ResourceMeasurementPhaseName[] = [
    "rejected-oversized-entries",
    "upstream-stream-errors",
    "cancelled-streams",
    "overlapping-writes",
    "invalidation-during-write",
  ];
  if (phases.length !== workload.measurementBatches + churnPhaseNames.length + 2) return false;
  return phases.every((phase, index) => {
    if (phase.samples.length !== workload.samplesPerPhase) return false;
    if (index === 0) {
      return phase.name === "post-warmup" && phase.activity === null && phase.releaseCheck === null;
    }
    if (index === phases.length - 1) {
      return (
        phase.name === "post-cleanup" && phase.activity === null && phase.releaseCheck === null
      );
    }
    const expectedName =
      index <= workload.measurementBatches
        ? `steady-state-batch-${index}`
        : churnPhaseNames[index - workload.measurementBatches - 1];
    return phase.name === expectedName && phase.activity !== null && phase.releaseCheck !== null;
  });
}

function isResourceRunEvidence(value: unknown): value is ResourceRunEvidence {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== RESOURCE_EVIDENCE_SCHEMA_VERSION ||
    !isEnvironment(value["environment"]) ||
    !isResourceWorkloadParameters(value["workload"]) ||
    !isResourceThresholds(value["thresholds"]) ||
    !isResourceObservations(value["observations"]) ||
    !isResourceThresholdEvaluation(value["thresholdEvaluation"]) ||
    !isCleanup(value["cleanup"]) ||
    !hasString(value, "reproductionCommand") ||
    !Array.isArray(value["phases"]) ||
    !value["phases"].every(isResourcePhase)
  ) {
    return false;
  }
  const expectedEvaluation = evaluateResourceThresholds(value["observations"], value["thresholds"]);
  return (
    hasExpectedPhaseShape(value["phases"], value["workload"]) &&
    thresholdEvaluationsMatch(value["thresholdEvaluation"], expectedEvaluation)
  );
}

export function parseResourceRunEvidence(value: unknown): ResourceRunEvidence {
  if (!isResourceRunEvidence(value)) {
    throw new Error("Resource measurement child emitted malformed evidence");
  }

  return value;
}
