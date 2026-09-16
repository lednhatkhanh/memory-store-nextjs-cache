import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { StartedTestContainer } from "testcontainers";

import {
  DEFAULT_RESOURCE_THRESHOLDS,
  DEFAULT_RESOURCE_WORKLOAD,
  RESOURCE_CHILD_TIMEOUT_MILLISECONDS,
  RESOURCE_CPU_QUOTA_CORES,
  RESOURCE_KERNEL_MEMORY_LIMIT_BYTES,
  RESOURCE_KERNEL_SWAP_LIMIT_BYTES,
  RESOURCE_REDIS_IMAGE,
  RESOURCE_REDIS_MEMORY_LIMIT_BYTES,
  RESOURCE_V8_OLD_SPACE_LIMIT_BYTES,
} from "./config.ts";
import {
  coordinateResourceMeasurement,
  type DisposableRedisResource,
  type MeasurementChild,
  type RedisConnection,
} from "./coordinator.ts";
import { parseResourceRunEvidence } from "./evidence.ts";
import type { ResourceExecutionLimitsEvidence, ResourceWorkloadParameters } from "./evidence.ts";
import { applyKernelLimits } from "./kernel-limits.ts";
import type { ResourceChildRequest } from "./protocol.ts";

const REDIS_PORT = 6_379;
const CHILD_TERMINATION_GRACE_MILLISECONDS = 2_000;
const MAXIMUM_CHILD_ERROR_BYTES = 16 * 1_024;
const MEBIBYTE = 1_024 * 1_024;

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
    .withResourcesQuota({
      cpu: RESOURCE_CPU_QUOTA_CORES,
      memory: RESOURCE_REDIS_MEMORY_LIMIT_BYTES / (1_024 * MEBIBYTE),
    })
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

function optionsFromArguments(arguments_: string[]): Readonly<{
  failureDiagnostics: boolean;
  workload: ResourceWorkloadParameters;
}> {
  const failureDiagnostics = arguments_.includes("--failure-diagnostics");
  const seedArguments = arguments_.filter((argument) => argument !== "--failure-diagnostics");
  if (seedArguments.length === 0) {
    return { failureDiagnostics, workload: DEFAULT_RESOURCE_WORKLOAD };
  }
  const seedValue =
    seedArguments.length === 2 && seedArguments[0] === "--seed"
      ? seedArguments[1]
      : seedArguments.length === 1 && seedArguments[0]?.startsWith("--seed=")
        ? seedArguments[0].slice("--seed=".length)
        : null;
  const seed = seedValue === null ? Number.NaN : Number(seedValue);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error("Resource measurement seed must be a non-negative safe integer");
  }
  return { failureDiagnostics, workload: { ...DEFAULT_RESOURCE_WORKLOAD, seed } };
}

async function prepareFailureDiagnosticsDirectory(seed: number): Promise<string> {
  const directory = fileURLToPath(new URL(`../.resource-diagnostics/${seed}/`, import.meta.url));
  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
  return directory;
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

async function createMeasurementChild(
  connection: RedisConnection,
  workload: ResourceWorkloadParameters,
  failureDiagnostics: boolean,
): Promise<MeasurementChild> {
  const failureDiagnosticsDirectory = failureDiagnostics
    ? await prepareFailureDiagnosticsDirectory(workload.seed)
    : null;
  const execArgv = [
    "--expose-gc",
    `--max-old-space-size=${RESOURCE_V8_OLD_SPACE_LIMIT_BYTES / MEBIBYTE}`,
  ];
  if (failureDiagnosticsDirectory) {
    execArgv.push(
      "--report-exclude-env",
      "--report-exclude-network",
      `--report-directory=${failureDiagnosticsDirectory}`,
    );
  }
  const child = fork(fileURLToPath(new URL("./workload-child.ts", import.meta.url)), [], {
    execArgv,
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
  if (!child.pid) {
    child.kill("SIGKILL");
    throw new Error("Resource measurement child did not report a process ID");
  }
  const kernelLimits = await applyKernelLimits(child.pid, {
    cpuQuotaCores: RESOURCE_CPU_QUOTA_CORES,
    memoryLimitBytes: RESOURCE_KERNEL_MEMORY_LIMIT_BYTES,
    swapLimitBytes: RESOURCE_KERNEL_SWAP_LIMIT_BYTES,
  });

  const request: ResourceChildRequest = {
    connection,
    executionLimits: {
      failureDiagnostics: {
        enabled: failureDiagnostics,
        maxDiagnosticReports: 1,
        maxHeapSnapshots: 1,
      },
      kernelLimits: kernelLimits.evidence,
      redisMemoryLimitBytes: RESOURCE_REDIS_MEMORY_LIMIT_BYTES,
      timeoutMilliseconds: RESOURCE_CHILD_TIMEOUT_MILLISECONDS,
      v8OldSpaceLimitBytes: RESOURCE_V8_OLD_SPACE_LIMIT_BYTES,
    } satisfies ResourceExecutionLimitsEvidence,
    failureDiagnosticsDirectory,
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
  let kernelLimitsCleaned = false;
  const cleanupKernelLimits = async (): Promise<void> => {
    if (kernelLimitsCleaned) return;
    kernelLimitsCleaned = true;
    await kernelLimits.cleanup();
  };

  return {
    message,
    async terminate() {
      try {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        const exited = exit.promise.then(() => true as const);
        if (!(await waitForExitWithin(child, exited, CHILD_TERMINATION_GRACE_MILLISECONDS))) {
          child.kill("SIGKILL");
          if (!(await waitForExitWithin(child, exited, CHILD_TERMINATION_GRACE_MILLISECONDS))) {
            throw new Error("Resource measurement child could not be terminated");
          }
        }
      } finally {
        await cleanupKernelLimits();
      }
    },
  };
}

async function main(): Promise<void> {
  const options = optionsFromArguments(process.argv.slice(2));
  const evidence = await coordinateResourceMeasurement({
    createChild: async (connection) =>
      createMeasurementChild(connection, options.workload, options.failureDiagnostics),
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
