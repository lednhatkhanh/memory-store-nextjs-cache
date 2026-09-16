import { isNumber } from "es-toolkit";

import { isRecord } from "./validation.ts";

export type ResourceObservations = Readonly<{
  activeResourceDeltaCount: number;
  elapsedMilliseconds: number;
  maxArrayBuffersAndBuffersBytes: number;
  maxCurrentRssBytes: number;
  maxEventLoopDelayP99Milliseconds: number;
  maxEventLoopUtilization: number;
  maxExternalBytes: number;
  maxHeapUsedBytes: number;
  maxPendingWritesAfterPhase: number;
  peakConcurrencyPostGcRssRangeBytes: number;
  peakRssBytes: number;
  maxBufferedBytesAfterPhase: number;
  maxCapacityShortfallBytesAfterPhase: number;
  retainedArrayBuffersAndBuffersGrowthBytes: number;
  retainedExternalGrowthBytes: number;
  retainedHeapGrowthBytes: number;
  systemCpuMilliseconds: number;
  userCpuMilliseconds: number;
}>;

export type ResourceThresholds = Readonly<{
  maxActiveResourceDeltaCount: number;
  maxArrayBuffersAndBuffersBytes: number;
  maxCurrentRssBytes: number;
  maxElapsedMilliseconds: number;
  maxEventLoopDelayP99Milliseconds: number;
  maxEventLoopUtilization: number;
  maxExternalBytes: number;
  maxHeapUsedBytes: number;
  maxPendingWritesAfterPhase: number;
  maxPeakConcurrencyPostGcRssRangeBytes: number;
  maxPeakRssBytes: number;
  maxBufferedBytesAfterPhase: number;
  maxCapacityShortfallBytesAfterPhase: number;
  maxRetainedArrayBuffersAndBuffersGrowthBytes: number;
  maxRetainedExternalGrowthBytes: number;
  maxRetainedHeapGrowthBytes: number;
  maxSystemCpuMilliseconds: number;
  maxUserCpuMilliseconds: number;
}>;

export type ResourceThresholdViolation = Readonly<{
  actual: number;
  metric: keyof ResourceObservations;
  threshold: number;
}>;

export type ResourceThresholdEvaluation = Readonly<{
  passed: boolean;
  violations: ResourceThresholdViolation[];
}>;

type ThresholdRule = Readonly<{
  metric: keyof ResourceObservations;
  threshold: keyof ResourceThresholds;
}>;

const thresholdRules: ThresholdRule[] = [
  { metric: "activeResourceDeltaCount", threshold: "maxActiveResourceDeltaCount" },
  { metric: "maxBufferedBytesAfterPhase", threshold: "maxBufferedBytesAfterPhase" },
  {
    metric: "maxCapacityShortfallBytesAfterPhase",
    threshold: "maxCapacityShortfallBytesAfterPhase",
  },
  { metric: "maxPendingWritesAfterPhase", threshold: "maxPendingWritesAfterPhase" },
  { metric: "retainedHeapGrowthBytes", threshold: "maxRetainedHeapGrowthBytes" },
  { metric: "retainedExternalGrowthBytes", threshold: "maxRetainedExternalGrowthBytes" },
  {
    metric: "retainedArrayBuffersAndBuffersGrowthBytes",
    threshold: "maxRetainedArrayBuffersAndBuffersGrowthBytes",
  },
  { metric: "maxHeapUsedBytes", threshold: "maxHeapUsedBytes" },
  { metric: "maxExternalBytes", threshold: "maxExternalBytes" },
  {
    metric: "maxArrayBuffersAndBuffersBytes",
    threshold: "maxArrayBuffersAndBuffersBytes",
  },
  { metric: "maxCurrentRssBytes", threshold: "maxCurrentRssBytes" },
  {
    metric: "peakConcurrencyPostGcRssRangeBytes",
    threshold: "maxPeakConcurrencyPostGcRssRangeBytes",
  },
  { metric: "peakRssBytes", threshold: "maxPeakRssBytes" },
  { metric: "userCpuMilliseconds", threshold: "maxUserCpuMilliseconds" },
  { metric: "systemCpuMilliseconds", threshold: "maxSystemCpuMilliseconds" },
  { metric: "elapsedMilliseconds", threshold: "maxElapsedMilliseconds" },
  { metric: "maxEventLoopUtilization", threshold: "maxEventLoopUtilization" },
  {
    metric: "maxEventLoopDelayP99Milliseconds",
    threshold: "maxEventLoopDelayP99Milliseconds",
  },
];

function hasFiniteNumbers(value: unknown, properties: string[]): value is Record<string, number> {
  return (
    isRecord(value) &&
    properties.every((property) => {
      const propertyValue = value[property];
      return isNumber(propertyValue) && Number.isFinite(propertyValue) && propertyValue >= 0;
    })
  );
}

const observationProperties: Array<keyof ResourceObservations> = [
  "activeResourceDeltaCount",
  "elapsedMilliseconds",
  "maxArrayBuffersAndBuffersBytes",
  "maxCurrentRssBytes",
  "maxEventLoopDelayP99Milliseconds",
  "maxEventLoopUtilization",
  "maxExternalBytes",
  "maxHeapUsedBytes",
  "maxPendingWritesAfterPhase",
  "peakConcurrencyPostGcRssRangeBytes",
  "peakRssBytes",
  "maxBufferedBytesAfterPhase",
  "maxCapacityShortfallBytesAfterPhase",
  "retainedArrayBuffersAndBuffersGrowthBytes",
  "retainedExternalGrowthBytes",
  "retainedHeapGrowthBytes",
  "systemCpuMilliseconds",
  "userCpuMilliseconds",
];

const thresholdProperties: Array<keyof ResourceThresholds> = [
  "maxActiveResourceDeltaCount",
  "maxArrayBuffersAndBuffersBytes",
  "maxCurrentRssBytes",
  "maxElapsedMilliseconds",
  "maxEventLoopDelayP99Milliseconds",
  "maxEventLoopUtilization",
  "maxExternalBytes",
  "maxHeapUsedBytes",
  "maxPendingWritesAfterPhase",
  "maxPeakConcurrencyPostGcRssRangeBytes",
  "maxPeakRssBytes",
  "maxBufferedBytesAfterPhase",
  "maxCapacityShortfallBytesAfterPhase",
  "maxRetainedArrayBuffersAndBuffersGrowthBytes",
  "maxRetainedExternalGrowthBytes",
  "maxRetainedHeapGrowthBytes",
  "maxSystemCpuMilliseconds",
  "maxUserCpuMilliseconds",
];

function isObservationMetric(value: unknown): value is keyof ResourceObservations {
  return typeof value === "string" && observationProperties.some((property) => property === value);
}

export function isResourceObservations(value: unknown): value is ResourceObservations {
  return hasFiniteNumbers(value, observationProperties);
}

export function isResourceThresholds(value: unknown): value is ResourceThresholds {
  return hasFiniteNumbers(value, thresholdProperties);
}

export function isResourceThresholdEvaluation(
  value: unknown,
): value is ResourceThresholdEvaluation {
  return (
    isRecord(value) &&
    typeof value["passed"] === "boolean" &&
    Array.isArray(value["violations"]) &&
    value["violations"].every(
      (violation) =>
        isRecord(violation) &&
        isObservationMetric(violation["metric"]) &&
        typeof violation["actual"] === "number" &&
        Number.isFinite(violation["actual"]) &&
        typeof violation["threshold"] === "number" &&
        Number.isFinite(violation["threshold"]),
    )
  );
}

export function evaluateResourceThresholds(
  observations: ResourceObservations,
  thresholds: ResourceThresholds,
): ResourceThresholdEvaluation {
  const violations = thresholdRules.flatMap(({ metric, threshold }) => {
    const actual = observations[metric];
    const limit = thresholds[threshold];
    return actual > limit ? [{ actual, metric, threshold: limit }] : [];
  });

  return { passed: violations.length === 0, violations };
}
