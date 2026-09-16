import type { RedisConnection } from "./coordinator.ts";
import { isResourceWorkloadParameters, type ResourceWorkloadParameters } from "./evidence.ts";
import { isResourceThresholds, type ResourceThresholds } from "./thresholds.ts";
import { isRecord } from "./validation.ts";

export type ResourceChildRequest = Readonly<{
  connection: RedisConnection;
  redisImage: string;
  thresholds: ResourceThresholds;
  type: "start-resource-measurement";
  workload: ResourceWorkloadParameters;
}>;

export function parseResourceChildRequest(value: unknown): ResourceChildRequest {
  if (!isRecord(value)) {
    throw new Error("Resource measurement child received a malformed request");
  }
  const connection = value["connection"];
  const redisImage = value["redisImage"];
  const thresholds = value["thresholds"];
  const workload = value["workload"];
  const host = isRecord(connection) ? connection["host"] : null;
  const port = isRecord(connection) ? connection["port"] : null;
  if (
    value["type"] !== "start-resource-measurement" ||
    !isRecord(connection) ||
    typeof host !== "string" ||
    typeof port !== "number" ||
    !Number.isSafeInteger(port) ||
    typeof redisImage !== "string" ||
    !isResourceThresholds(thresholds) ||
    !isResourceWorkloadParameters(workload)
  ) {
    throw new Error("Resource measurement child received a malformed request");
  }

  return {
    connection: { host, port },
    redisImage,
    thresholds,
    type: "start-resource-measurement",
    workload,
  };
}
