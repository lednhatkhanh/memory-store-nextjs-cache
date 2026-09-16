import { describe, expect, it } from "vitest";

import {
  coordinateResourceMeasurement,
  type DisposableRedisResource,
  type MeasurementChild,
} from "../resource/coordinator.ts";

const validEvidence = { schemaVersion: 1 } as const;

type Scenario = Readonly<{
  expected:
    | Readonly<{ status: "fulfilled"; value: typeof validEvidence }>
    | Readonly<{ message: string; status: "rejected" }>;
  name: "crash" | "malformed" | "success" | "timeout";
}>;

async function childMessageFor(scenario: Scenario["name"]): Promise<unknown> {
  if (scenario === "crash") return Promise.reject(new Error("child crashed"));
  if (scenario === "malformed") return Promise.resolve({ unexpected: true });
  if (scenario === "success") return Promise.resolve(validEvidence);
  return await Promise.withResolvers<unknown>().promise;
}

const scenarios: Scenario[] = [
  { expected: { status: "fulfilled", value: validEvidence }, name: "success" },
  {
    expected: { message: "Resource measurement timed out after 10ms", status: "rejected" },
    name: "timeout",
  },
  { expected: { message: "child crashed", status: "rejected" }, name: "crash" },
  {
    expected: { message: "malformed child evidence", status: "rejected" },
    name: "malformed",
  },
];

describe("resource measurement coordination", () => {
  it.each(scenarios)(
    "terminates the child and disposable Redis resource after $name",
    async ({ expected, name }) => {
      const cleanupEvents: string[] = [];
      const run = coordinateResourceMeasurement({
        createChild(): MeasurementChild {
          return {
            message: childMessageFor(name),
            async terminate() {
              cleanupEvents.push("child terminated");
            },
          };
        },
        async createRedisResource(): Promise<DisposableRedisResource> {
          return {
            connection: { host: "127.0.0.1", port: 63_790 },
            async stop() {
              cleanupEvents.push("redis stopped");
            },
          };
        },
        parseEvidence(value) {
          if (value !== validEvidence) throw new Error("malformed child evidence");
          return value;
        },
        timeoutMilliseconds: 10,
      });

      const outcome = await run.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({
          message: error instanceof Error ? error.message : "Unknown error",
          status: "rejected" as const,
        }),
      );

      expect(outcome).toEqual(expected);
      expect(cleanupEvents).toEqual(["child terminated", "redis stopped"]);
    },
    1_000,
  );
});
