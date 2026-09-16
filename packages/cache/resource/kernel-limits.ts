import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import path from "node:path";

import type { KernelLimitEvidence } from "./evidence.ts";

const CGROUP_ROOT = "/sys/fs/cgroup";
const CPU_PERIOD_MICROSECONDS = 100_000;
const MAXIMUM_SKIP_REASON_CHARACTERS = 256;

export type KernelLimitLease = Readonly<{
  cleanup: () => Promise<void>;
  evidence: KernelLimitEvidence;
}>;

export type KernelLimitConfiguration = Readonly<{
  cpuQuotaCores: number;
  memoryLimitBytes: number;
  swapLimitBytes: number;
}>;

const noKernelCleanup = async (): Promise<void> => Promise.resolve();

function skippedEvidence(
  configuration: KernelLimitConfiguration,
  reason: string,
): KernelLimitEvidence {
  return {
    ...configuration,
    reason: reason.replaceAll(/\s+/gu, " ").slice(0, MAXIMUM_SKIP_REASON_CHARACTERS),
    status: "skipped",
  };
}

async function currentCgroupDirectory(): Promise<string> {
  const membership = await readFile("/proc/self/cgroup", "utf8");
  const unifiedEntry = membership
    .split(/\r?\n/u)
    .map((line) => line.split(":"))
    .find(
      ([hierarchy, controllers, memberPath]) =>
        hierarchy === "0" && controllers === "" && typeof memberPath === "string",
    );
  const memberPath = unifiedEntry?.[2];
  if (!memberPath?.startsWith("/")) {
    throw new Error("the process does not report a cgroup v2 membership path");
  }
  const directory = path.resolve(CGROUP_ROOT, `.${memberPath}`);
  if (directory !== CGROUP_ROOT && !directory.startsWith(`${CGROUP_ROOT}${path.sep}`)) {
    throw new Error("the cgroup v2 membership path escapes the cgroup filesystem");
  }
  return directory;
}

export async function applyKernelLimits(
  processId: number,
  configuration: KernelLimitConfiguration,
): Promise<KernelLimitLease> {
  if (platform() !== "linux") {
    return {
      cleanup: noKernelCleanup,
      evidence: skippedEvidence(
        configuration,
        "Kernel cgroup v2 quotas are only available on Linux",
      ),
    };
  }

  let cgroupPath: string | undefined;
  let created = false;
  try {
    const delegatedDirectory = await currentCgroupDirectory();
    const controllers = (
      await readFile(path.join(delegatedDirectory, "cgroup.controllers"), "utf8")
    )
      .trim()
      .split(/\s+/u);
    if (!controllers.includes("memory") || !controllers.includes("cpu")) {
      throw new Error("cgroup v2 memory and CPU controllers are not both delegated");
    }
    cgroupPath = path.join(delegatedDirectory, `memory-store-cache-${processId}`);
    await mkdir(cgroupPath);
    created = true;
    await writeFile(path.join(cgroupPath, "memory.max"), String(configuration.memoryLimitBytes));
    await writeFile(path.join(cgroupPath, "memory.swap.max"), String(configuration.swapLimitBytes));
    await writeFile(
      path.join(cgroupPath, "cpu.max"),
      `${Math.floor(configuration.cpuQuotaCores * CPU_PERIOD_MICROSECONDS)} ${CPU_PERIOD_MICROSECONDS}`,
    );
    await writeFile(path.join(cgroupPath, "cgroup.procs"), String(processId));
    const appliedCgroupPath = cgroupPath;

    return {
      async cleanup() {
        await rmdir(appliedCgroupPath);
      },
      evidence: {
        ...configuration,
        status: "enforced",
      },
    };
  } catch (error) {
    if (created && cgroupPath) await rmdir(cgroupPath).catch(() => null);
    const detail = error instanceof Error ? error.message : "unknown cgroup error";
    return {
      cleanup: noKernelCleanup,
      evidence: skippedEvidence(
        configuration,
        `Linux cgroup v2 quotas could not be applied: ${detail}`,
      ),
    };
  }
}
