import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { StartedTestContainer } from "testcontainers";

import {
  DEFAULT_RESOURCE_THRESHOLDS,
  DEFAULT_RESOURCE_WORKLOAD,
  RESOURCE_CHILD_TIMEOUT_MILLISECONDS,
  RESOURCE_REDIS_IMAGE,
} from "./config.ts";
import {
  coordinateResourceMeasurement,
  type DisposableRedisResource,
  type MeasurementChild,
  type RedisConnection,
} from "./coordinator.ts";
import { parseResourceRunEvidence } from "./evidence.ts";
import type { ResourceWorkloadParameters } from "./evidence.ts";
import type { ResourceChildRequest } from "./protocol.ts";

const REDIS_PORT = 6_379;
const CHILD_TERMINATION_GRACE_MILLISECONDS = 2_000;
const MAXIMUM_CHILD_ERROR_BYTES = 16 * 1_024;

function configureDockerHost(): void {
  // oxlint-disable-next-line node/no-process-env -- Testcontainers must follow the active Docker context.
  if (process.env["DOCKER_HOST"]) return;
  const activeDockerHost = execFileSync(
    "docker",
    ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  ).trim();
  const dockerHost: unknown = JSON.parse(activeDockerHost);
  if (typeof dockerHost !== "string") {
    throw new Error("Active Docker context did not provide a host");
  }
  // oxlint-disable-next-line node/no-process-env -- Testcontainers reads this documented Docker endpoint.
  process.env["DOCKER_HOST"] = dockerHost;
}

async function createRedisResource(): Promise<DisposableRedisResource> {
  configureDockerHost();
  const { GenericContainer, Wait } = await import("testcontainers");
  const container: StartedTestContainer = await new GenericContainer(RESOURCE_REDIS_IMAGE)
    .withExposedPorts(REDIS_PORT)
    .withStartupTimeout(60_000)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .start();

  return {
    connection: {
      host: container.getHost(),
      port: container.getMappedPort(REDIS_PORT),
    },
    async stop() {
      await container.stop();
    },
  };
}

function childFailureMessage(
  code: number | null,
  signal: NodeJS.Signals | null,
  standardError: string,
): Error {
  const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
  const detail = standardError.trim();
  return new Error(
    detail.length > 0
      ? `Resource measurement child ended with ${status}: ${detail}`
      : `Resource measurement child ended with ${status} before emitting evidence`,
  );
}

function appendBoundedError(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString("utf8")}`.slice(-MAXIMUM_CHILD_ERROR_BYTES);
}

function workloadFromArguments(arguments_: string[]): ResourceWorkloadParameters {
  if (arguments_.length === 0) return DEFAULT_RESOURCE_WORKLOAD;
  const seedValue =
    arguments_.length === 2 && arguments_[0] === "--seed"
      ? arguments_[1]
      : arguments_.length === 1 && arguments_[0]?.startsWith("--seed=")
        ? arguments_[0].slice("--seed=".length)
        : null;
  const seed = seedValue === null ? Number.NaN : Number(seedValue);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("Resource measurement seed must be a non-negative safe integer");
  }
  return { ...DEFAULT_RESOURCE_WORKLOAD, seed };
}

async function waitForExitWithin(
  child: ChildProcess,
  exit: Promise<true>,
  milliseconds: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds);
    exit
      .then(() => {
        clearTimeout(timer);
        resolve(true);
        return true;
      })
      .catch(() => false);
  });
}

function createMeasurementChild(
  connection: RedisConnection,
  workload: ResourceWorkloadParameters,
): MeasurementChild {
  const child = fork(fileURLToPath(new URL("./workload-child.ts", import.meta.url)), [], {
    execArgv: ["--expose-gc"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const exit =
    Promise.withResolvers<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>();
  const receivedMessage = Promise.withResolvers<unknown>();
  let evidenceReceived = false;
  let standardError = "";

  child.stderr?.on("data", (chunk: Buffer) => {
    standardError = appendBoundedError(standardError, chunk);
  });
  child.once("error", (error) => receivedMessage.reject(error));
  child.once("message", (value: unknown) => {
    evidenceReceived = true;
    receivedMessage.resolve(value);
  });
  child.once("exit", (code, signal) => {
    exit.resolve({ code, signal });
    if (!evidenceReceived) {
      receivedMessage.reject(childFailureMessage(code, signal, standardError));
    }
  });

  const request: ResourceChildRequest = {
    connection,
    redisImage: RESOURCE_REDIS_IMAGE,
    thresholds: DEFAULT_RESOURCE_THRESHOLDS,
    type: "start-resource-measurement",
    workload,
  };
  child.send(request, (error) => {
    if (error) receivedMessage.reject(error);
  });

  const message = Promise.all([receivedMessage.promise, exit.promise]).then(([value, status]) => {
    if (status.code !== 0 || status.signal !== null) {
      throw childFailureMessage(status.code, status.signal, standardError);
    }
    return value;
  });

  return {
    message,
    async terminate() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const exited = exit.promise.then(() => true as const);
      if (!(await waitForExitWithin(child, exited, CHILD_TERMINATION_GRACE_MILLISECONDS))) {
        child.kill("SIGKILL");
        if (!(await waitForExitWithin(child, exited, CHILD_TERMINATION_GRACE_MILLISECONDS))) {
          throw new Error("Resource measurement child could not be terminated");
        }
      }
    },
  };
}

async function main(): Promise<void> {
  const workload = workloadFromArguments(process.argv.slice(2));
  const evidence = await coordinateResourceMeasurement({
    createChild: (connection) => createMeasurementChild(connection, workload),
    createRedisResource,
    parseEvidence: parseResourceRunEvidence,
    timeoutMilliseconds: RESOURCE_CHILD_TIMEOUT_MILLISECONDS,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!evidence.thresholdEvaluation.passed) process.exitCode = 1;
}

function reportFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown resource measurement failure";
  process.stderr.write(`Resource measurement failed: ${message}\n`);
  process.exitCode = 1;
}

main().catch(reportFailure);
