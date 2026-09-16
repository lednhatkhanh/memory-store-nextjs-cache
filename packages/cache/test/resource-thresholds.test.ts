import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  evaluateResourceThresholds,
  isResourceObservations,
  isResourceThresholds,
  type ResourceObservations,
  type ResourceThresholds,
} from "../resource/thresholds.js";

type ThresholdFixture = {
  observations: ResourceObservations;
  thresholds: ResourceThresholds;
};

async function loadFixture(name: string): Promise<ThresholdFixture> {
  const contents = await readFile(
    new URL(`./fixtures/resource-measurement/${name}.json`, import.meta.url),
    "utf8",
  );
  const parsed: unknown = JSON.parse(contents);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("observations" in parsed) ||
    !("thresholds" in parsed) ||
    !isResourceObservations(parsed.observations) ||
    !isResourceThresholds(parsed.thresholds)
  ) {
    throw new Error(`Malformed resource threshold fixture: ${name}`);
  }
  return { observations: parsed.observations, thresholds: parsed.thresholds };
}

describe("resource threshold evaluation", () => {
  it("reports a passing measurement fixture", async () => {
    const fixture = await loadFixture("passing");

    expect(evaluateResourceThresholds(fixture.observations, fixture.thresholds)).toEqual({
      passed: true,
      violations: [],
    });
  }, 1_000);

  it("reports every deliberately exceeded budget", async () => {
    const fixture = await loadFixture("exceeded");

    expect(evaluateResourceThresholds(fixture.observations, fixture.thresholds)).toEqual({
      passed: false,
      violations: [
        {
          actual: 100_663_296,
          metric: "maxHeapUsedBytes",
          threshold: 67_108_864,
        },
        {
          actual: 201_326_592,
          metric: "maxCurrentRssBytes",
          threshold: 134_217_728,
        },
        {
          actual: 104_857_600,
          metric: "peakConcurrencyPostGcRssRangeBytes",
          threshold: 67_108_864,
        },
        {
          actual: 209_715_200,
          metric: "peakRssBytes",
          threshold: 167_772_160,
        },
        {
          actual: 85,
          metric: "maxEventLoopDelayP99Milliseconds",
          threshold: 50,
        },
      ],
    });
  }, 1_000);

  it("rejects a controlled fixture that retains payloads and an active resource", async () => {
    const fixture = await loadFixture("retained-payload");

    expect(evaluateResourceThresholds(fixture.observations, fixture.thresholds)).toEqual({
      passed: false,
      violations: [
        {
          actual: 1,
          metric: "activeResourceDeltaCount",
          threshold: 0,
        },
        {
          actual: 16_777_216,
          metric: "retainedHeapGrowthBytes",
          threshold: 4_194_304,
        },
        {
          actual: 8_388_608,
          metric: "retainedExternalGrowthBytes",
          threshold: 1_048_576,
        },
        {
          actual: 8_388_608,
          metric: "retainedArrayBuffersAndBuffersGrowthBytes",
          threshold: 1_048_576,
        },
      ],
    });
  }, 1_000);
});
