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

export const RESOURCE_EVIDENCE_SCHEMA_VERSION = 3;

export type KernelLimitEvidence = Readonly<{
  cpuQuotaCores: number;
  memoryLimitBytes: number;
  reason?: string;
  status: "enforced" | "skipped";
  swapLimitBytes: number;
}>;

export type ResourceExecutionLimitsEvidence = Readonly<{
  failureDiagnostics: Readonly<{
    enabled: boolean;
    maxDiagnosticReports: number;
    maxHeapSnapshots: number;
  }>;
  kernelLimits: KernelLimitEvidence;
  redisMemoryLimitBytes: number;
  timeoutMilliseconds: number;
  v8OldSpaceLimitBytes: number;
}>;

export type ResourceWorkloadParameters = Readonly<{
  chunkBytes: number;
  concurrentStreamsPerBatch: number;
  garbageCollectionPassesPerSample: number;
  invalidationsPerBatch: number;
  keyCount: number;
  maxBufferedBytes: number;
  maxEntrySizeBytes: number;
  measurementBatches: number;
  peakConcurrentStreams: number;
  peakMaxBufferedBytes: number;
  peakMaxEntrySizeBytes: number;
  peakRuns: number;
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
  peakMemory: ResourceMemoryEvidence;
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

export type ResourceConcurrencyEvidence = Readonly<{
  bufferedBytesAtPeak: number;
  pendingWritesAtPeak: number;
  run: number;
}>;

export type ResourceLimitOutcomeEvidence = Readonly<{
  attemptedBytes: number;
  boundary: "above" | "at" | "below";
  outcome: "accepted" | "rejected";
  reason: "buffer-limit" | "entry-size-limit" | null;
}>;

export type ResourceLimitExerciseEvidence = Readonly<{
  aggregate: ResourceLimitOutcomeEvidence[];
  diagnostics: Readonly<
    Array<{
      event: "entry-rejected";
      limitBytes: number;
      observedBytes: number;
      reason: "buffer-limit" | "entry-size-limit";
    }>
  >;
  perEntry: ResourceLimitOutcomeEvidence[];
  previousValuesPreserved: boolean;
  reservationsReleased: boolean;
}>;

export type ResourceLifecyclePhaseName = "post-cleanup" | "post-warmup";
export type ResourceMeasurementPhaseName =
  | "buffer-limit-boundaries"
  | "cancelled-streams"
  | "invalidation-during-write"
  | "overlapping-writes"
  | "rejected-oversized-entries"
  | "upstream-stream-errors"
  | `peak-concurrency-run-${number}`
  | `steady-state-batch-${number}`;
export type ResourcePhaseName = ResourceLifecyclePhaseName | ResourceMeasurementPhaseName;

export type ResourcePhaseEvidence = Readonly<{
  activity: ResourceActivityEvidence | null;
  concurrency: ResourceConcurrencyEvidence | null;
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
  executionLimits: ResourceExecutionLimitsEvidence;
  failureArtifacts: string[];
  failureRerunCommand: string;
  limitExercise: ResourceLimitExerciseEvidence;
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
    "peakConcurrentStreams",
    "peakMaxBufferedBytes",
    "peakMaxEntrySizeBytes",
    "peakRuns",
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

function isResourceMemory(value: unknown): value is ResourceMemoryEvidence {
  if (!isRecord(value)) return false;
  return [
    "arrayBuffersAndBuffersBytes",
    "currentRssBytes",
    "externalBytes",
    "peakRssBytes",
    "v8HeapTotalBytes",
    "v8HeapUsedBytes",
  ].every((property) => hasFiniteNumber(value, property));
}

function isResourceSample(value: unknown): value is ResourceSampleEvidence {
  return (
    isRecord(value) &&
    isResourceMemory(value["memory"]) &&
    isFiniteNumberRecord(value["activeResourceTypes"])
  );
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
    isEventLoopDelay(value["eventLoop"]["delay"]) &&
    isResourceMemory(value["peakMemory"])
  );
}

function isResourcePhaseName(value: unknown): value is ResourcePhaseName {
  return (
    value === "buffer-limit-boundaries" ||
    value === "post-cleanup" ||
    value === "post-warmup" ||
    value === "cancelled-streams" ||
    value === "invalidation-during-write" ||
    value === "overlapping-writes" ||
    value === "rejected-oversized-entries" ||
    value === "upstream-stream-errors" ||
    (typeof value === "string" && /^peak-concurrency-run-[1-9]\d*$/u.test(value)) ||
    (typeof value === "string" && /^steady-state-batch-[1-9]\d*$/u.test(value))
  );
}

function isConcurrency(value: unknown): value is ResourceConcurrencyEvidence {
  const run = isRecord(value) ? value["run"] : null;
  return (
    isRecord(value) &&
    hasFiniteNumber(value, "bufferedBytesAtPeak") &&
    hasFiniteNumber(value, "pendingWritesAtPeak") &&
    isNumber(run) &&
    Number.isSafeInteger(run) &&
    run > 0
  );
}

function isResourcePhase(value: unknown): value is ResourcePhaseEvidence {
  const releaseCheck = isRecord(value) ? value["releaseCheck"] : null;
  return (
    isRecord(value) &&
    isResourcePhaseName(value["name"]) &&
    (value["activity"] === null || isResourceActivity(value["activity"])) &&
    (value["concurrency"] === null || isConcurrency(value["concurrency"])) &&
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

function isLimitOutcome(
  value: unknown,
  boundary: ResourceLimitOutcomeEvidence["boundary"],
  rejectionReason: NonNullable<ResourceLimitOutcomeEvidence["reason"]>,
): value is ResourceLimitOutcomeEvidence {
  const rejected = boundary === "above";
  return (
    isRecord(value) &&
    hasFiniteNumber(value, "attemptedBytes") &&
    value["boundary"] === boundary &&
    value["outcome"] === (rejected ? "rejected" : "accepted") &&
    value["reason"] === (rejected ? rejectionReason : null)
  );
}

function isLimitOutcomes(
  value: unknown,
  rejectionReason: NonNullable<ResourceLimitOutcomeEvidence["reason"]>,
): value is ResourceLimitOutcomeEvidence[] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isLimitOutcome(value[0], "below", rejectionReason) &&
    isLimitOutcome(value[1], "at", rejectionReason) &&
    isLimitOutcome(value[2], "above", rejectionReason)
  );
}

function isLimitExercise(value: unknown): value is ResourceLimitExerciseEvidence {
  return (
    isRecord(value) &&
    isLimitOutcomes(value["aggregate"], "buffer-limit") &&
    isLimitOutcomes(value["perEntry"], "entry-size-limit") &&
    value["previousValuesPreserved"] === true &&
    value["reservationsReleased"] === true &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].length === 2 &&
    value["diagnostics"].every(
      (diagnostic) =>
        isRecord(diagnostic) &&
        diagnostic["event"] === "entry-rejected" &&
        hasFiniteNumber(diagnostic, "limitBytes") &&
        hasFiniteNumber(diagnostic, "observedBytes") &&
        (diagnostic["reason"] === "buffer-limit" || diagnostic["reason"] === "entry-size-limit"),
    )
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

export function isResourceExecutionLimits(
  value: unknown,
): value is ResourceExecutionLimitsEvidence {
  if (
    !isRecord(value) ||
    !hasFiniteNumber(value, "redisMemoryLimitBytes") ||
    !hasFiniteNumber(value, "timeoutMilliseconds") ||
    !hasFiniteNumber(value, "v8OldSpaceLimitBytes") ||
    !isRecord(value["failureDiagnostics"]) ||
    typeof value["failureDiagnostics"]["enabled"] !== "boolean" ||
    !hasFiniteNumber(value["failureDiagnostics"], "maxDiagnosticReports") ||
    !hasFiniteNumber(value["failureDiagnostics"], "maxHeapSnapshots") ||
    !isRecord(value["kernelLimits"]) ||
    !hasFiniteNumber(value["kernelLimits"], "cpuQuotaCores") ||
    !hasFiniteNumber(value["kernelLimits"], "memoryLimitBytes") ||
    !hasFiniteNumber(value["kernelLimits"], "swapLimitBytes") ||
    (value["kernelLimits"]["status"] !== "enforced" &&
      value["kernelLimits"]["status"] !== "skipped")
  ) {
    return false;
  }
  const kernelLimits = value["kernelLimits"];
  return (
    (kernelLimits["status"] === "enforced" && !("reason" in kernelLimits)) ||
    (kernelLimits["status"] === "skipped" && hasString(kernelLimits, "reason"))
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

function isLifecyclePhase(phase: ResourcePhaseEvidence, name: ResourceLifecyclePhaseName): boolean {
  return (
    phase.name === name &&
    phase.activity === null &&
    phase.concurrency === null &&
    phase.releaseCheck === null
  );
}

function isMeasuredPhaseWithoutConcurrency(
  phase: ResourcePhaseEvidence,
  name: ResourceMeasurementPhaseName,
): boolean {
  return (
    phase.name === name &&
    phase.activity !== null &&
    phase.concurrency === null &&
    phase.releaseCheck !== null
  );
}

function phaseMatchesExpectedPosition(
  phase: ResourcePhaseEvidence,
  index: number,
  totalPhases: number,
  workload: ResourceWorkloadParameters,
  churnPhaseNames: ResourceMeasurementPhaseName[],
): boolean {
  if (index === 0) return isLifecyclePhase(phase, "post-warmup");
  if (index === totalPhases - 1) return isLifecyclePhase(phase, "post-cleanup");
  if (index <= workload.measurementBatches) {
    return isMeasuredPhaseWithoutConcurrency(phase, `steady-state-batch-${index}`);
  }
  if (index === workload.measurementBatches + 1) {
    return isMeasuredPhaseWithoutConcurrency(phase, "buffer-limit-boundaries");
  }
  const peakIndex = index - workload.measurementBatches - 1;
  if (peakIndex <= workload.peakRuns) {
    return (
      phase.name === `peak-concurrency-run-${peakIndex}` &&
      phase.activity !== null &&
      phase.concurrency?.run === peakIndex &&
      phase.concurrency.bufferedBytesAtPeak === workload.peakMaxBufferedBytes &&
      phase.concurrency.pendingWritesAtPeak === workload.peakConcurrentStreams &&
      phase.releaseCheck !== null
    );
  }
  const expectedName = churnPhaseNames[peakIndex - workload.peakRuns - 1];
  return expectedName ? isMeasuredPhaseWithoutConcurrency(phase, expectedName) : false;
}

function outcomesMatchLimit(outcomes: ResourceLimitOutcomeEvidence[], limit: number): boolean {
  return (
    outcomes[0]?.attemptedBytes === limit - 1 &&
    outcomes[1]?.attemptedBytes === limit &&
    outcomes[2]?.attemptedBytes === limit + 1
  );
}

function limitExerciseMatchesWorkload(
  exercise: ResourceLimitExerciseEvidence,
  workload: ResourceWorkloadParameters,
): boolean {
  const entryDiagnostic = exercise.diagnostics.find(
    (diagnostic) => diagnostic.reason === "entry-size-limit",
  );
  const bufferDiagnostic = exercise.diagnostics.find(
    (diagnostic) => diagnostic.reason === "buffer-limit",
  );
  return (
    outcomesMatchLimit(exercise.perEntry, workload.peakMaxEntrySizeBytes) &&
    outcomesMatchLimit(exercise.aggregate, workload.peakMaxBufferedBytes) &&
    entryDiagnostic?.limitBytes === workload.peakMaxEntrySizeBytes &&
    entryDiagnostic.observedBytes === workload.peakMaxEntrySizeBytes + 1 &&
    bufferDiagnostic?.limitBytes === workload.peakMaxBufferedBytes &&
    bufferDiagnostic.observedBytes === workload.peakMaxBufferedBytes + 1
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
  if (
    phases.length !==
    workload.measurementBatches + workload.peakRuns + churnPhaseNames.length + 3
  ) {
    return false;
  }
  return phases.every(
    (phase, index) =>
      phase.samples.length === workload.samplesPerPhase &&
      phaseMatchesExpectedPosition(phase, index, phases.length, workload, churnPhaseNames),
  );
}

function hasFailureEvidence(value: Record<string, unknown>): boolean {
  const failureArtifacts = value["failureArtifacts"];
  return (
    Array.isArray(failureArtifacts) &&
    failureArtifacts.every((artifact) => typeof artifact === "string") &&
    failureArtifacts.length <= 2 &&
    hasString(value, "failureRerunCommand")
  );
}

function hasPhaseEvidence(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value["phases"]) &&
    value["phases"].every(isResourcePhase) &&
    isCleanup(value["cleanup"])
  );
}

function hasCoreEvidence(value: Record<string, unknown>): boolean {
  return (
    value["schemaVersion"] === RESOURCE_EVIDENCE_SCHEMA_VERSION &&
    isEnvironment(value["environment"]) &&
    isResourceExecutionLimits(value["executionLimits"]) &&
    isLimitExercise(value["limitExercise"]) &&
    isResourceWorkloadParameters(value["workload"]) &&
    isResourceThresholds(value["thresholds"]) &&
    isResourceObservations(value["observations"]) &&
    isResourceThresholdEvaluation(value["thresholdEvaluation"]) &&
    hasString(value, "reproductionCommand")
  );
}

function hasResourceRunFields(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ResourceRunEvidence {
  return hasCoreEvidence(value) && hasFailureEvidence(value) && hasPhaseEvidence(value);
}

function isResourceRunEvidence(value: unknown): value is ResourceRunEvidence {
  if (!isRecord(value) || !hasResourceRunFields(value)) {
    return false;
  }
  const expectedEvaluation = evaluateResourceThresholds(value.observations, value.thresholds);
  const failureArtifactsMatchMode = value.executionLimits.failureDiagnostics.enabled
    ? value.failureArtifacts.filter((artifact) => artifact.endsWith(".json")).length === 1 &&
      value.failureArtifacts.filter((artifact) => artifact.endsWith(".heapsnapshot")).length ===
        1 &&
      new Set(value.failureArtifacts).size === 2 &&
      value.executionLimits.failureDiagnostics.maxDiagnosticReports === 1 &&
      value.executionLimits.failureDiagnostics.maxHeapSnapshots === 1
    : value.failureArtifacts.length === 0;
  return (
    hasExpectedPhaseShape(value.phases, value.workload) &&
    limitExerciseMatchesWorkload(value.limitExercise, value.workload) &&
    failureArtifactsMatchMode &&
    thresholdEvaluationsMatch(value.thresholdEvaluation, expectedEvaluation)
  );
}

export function parseResourceRunEvidence(value: unknown): ResourceRunEvidence {
  if (!isResourceRunEvidence(value)) {
    throw new Error("Resource measurement child emitted malformed evidence");
  }

  return value;
}
