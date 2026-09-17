import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";

import { createContentService } from "@memory-store/content-service/app";
import ky from "ky";
import type { StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const REDIS_PORT = 6379;
const require = createRequire(import.meta.url);
const nextCli = path.join(path.dirname(require.resolve("next/package.json")), "dist/bin/next");

type ApplicationInstance = {
  id: string;
  logs: string[];
  process: ChildProcess;
  url: string;
};

type ApplicationEnvironment = {
  contentServiceUrl: string;
  namespace: string;
  revalidationSecret: string;
  redisUrl: string;
};

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not allocate a local port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function configureContainerRuntime(): void {
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
  process.env["DOCKER_HOST"] = dockerHost;
}

async function waitForApplication(
  url: string,
  process: ChildProcess,
  logs: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready:\n${logs.join("")}`);
    }
    try {
      const response = await ky.get(url, { retry: 0, timeout: 1_000, throwHttpErrors: false });
      if (response.status === 200) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Next.js did not become ready:\n${logs.join("")}`);
}

async function stopProcess(process: ChildProcess | undefined): Promise<void> {
  if (!process || process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([once(process, "exit"), delay(5_000)]);
  if (process.exitCode === null) {
    process.kill("SIGKILL");
    await once(process, "exit");
  }
}

async function startApplication(
  id: string,
  environment: ApplicationEnvironment,
): Promise<ApplicationInstance> {
  const port = await getAvailablePort();
  const instance: ApplicationInstance = {
    id,
    logs: [],
    process: spawn(
      process.execPath,
      [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: {
          ...process.env,
          CACHE_INSTANCE_ID: id,
          CONTENT_SERVICE_URL: environment.contentServiceUrl,
          REDIS_CACHE_NAMESPACE: environment.namespace,
          REDIS_URL: environment.redisUrl,
          REVALIDATION_SECRET: environment.revalidationSecret,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
    url: `http://127.0.0.1:${port}`,
  };
  instance.process.stdout?.on("data", (chunk: Buffer) => instance.logs.push(chunk.toString()));
  instance.process.stderr?.on("data", (chunk: Buffer) => instance.logs.push(chunk.toString()));
  try {
    await waitForApplication(instance.url, instance.process, instance.logs);
    return instance;
  } catch (error) {
    await stopProcess(instance.process);
    throw error;
  }
}

function formatApplicationLogs(instances: ApplicationInstance[]): string {
  return instances
    .map(
      (instance) =>
        `\n[${instance.id}; pid=${instance.process.pid ?? "unknown"}; exit=${instance.process.exitCode ?? "running"}]\n${instance.logs.join("") || "<no output>"}`,
    )
    .join("");
}

async function startTrackedApplication(
  id: string,
  environment: ApplicationEnvironment,
  instances: ApplicationInstance[],
): Promise<ApplicationInstance> {
  try {
    const instance = await startApplication(id, environment);
    instances.push(instance);
    return instance;
  } catch (error) {
    throw new Error(`Could not start ${id}:${formatApplicationLogs(instances)}`, { cause: error });
  }
}

async function waitForDiagnostic(
  instance: ApplicationInstance,
  result: "hit" | "miss",
  instances: ApplicationInstance[],
): Promise<void> {
  const diagnostic = JSON.stringify({ cache: "remote", instance: instance.id, result });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (instance.logs.join("").includes(diagnostic)) return;
    if (instance.process.exitCode !== null) break;
    await delay(50);
  }
  throw new Error(
    `Expected ${instance.id} to report a cache ${result}:${formatApplicationLogs(instances)}`,
  );
}

async function getRenderedContent(
  instance: ApplicationInstance,
  instances: ApplicationInstance[],
  pathname = "/cache-demo/welcome",
): Promise<string> {
  try {
    return await ky.get(`${instance.url}${pathname}`, { retry: 0 }).text();
  } catch (error) {
    throw new Error(`Request to ${instance.id} failed:${formatApplicationLogs(instances)}`, {
      cause: error,
    });
  }
}

async function submitPathRevalidation(
  instance: ApplicationInstance,
  instances: ApplicationInstance[],
  slug: string,
): Promise<string> {
  const pathname = `/path-cache-demo/${slug}`;
  const rendered = await getRenderedContent(instance, instances, pathname);
  const actionField = rendered.match(/name="(\$ACTION_ID_[^"]+)"/u)?.[1];
  if (!actionField) {
    throw new Error(
      `Could not find the path revalidation Server Action:${formatApplicationLogs(instances)}`,
    );
  }
  const formData = new FormData();
  formData.set(actionField, "");
  formData.set("slug", slug);

  try {
    return await ky
      .post(`${instance.url}${pathname}`, {
        body: formData,
        headers: { origin: instance.url },
        retry: 0,
      })
      .text();
  } catch (error) {
    throw new Error(
      `Path revalidation on ${instance.id} failed:${formatApplicationLogs(instances)}`,
      {
        cause: error,
      },
    );
  }
}

async function invalidatePublishedDocument(
  instance: ApplicationInstance,
  environment: ApplicationEnvironment,
  options: { policy?: "stale-while-revalidate"; slug?: string } = {},
): Promise<unknown> {
  return ky
    .post(`${instance.url}/api/revalidate/content`, {
      headers: { authorization: `Bearer ${environment.revalidationSecret}` },
      json: {
        locale: "en",
        site: "reference",
        slug: options.slug ?? "welcome",
        ...(options.policy ? { policy: options.policy } : {}),
      },
      retry: 0,
    })
    .json();
}

function expectRenderedRevision(
  rendered: string,
  revision: string,
  instances: ApplicationInstance[],
): void {
  expectRenderedContent(instances, `Rendered revision was not ${revision}`, () => {
    expect(rendered).toContain(revision);
  });
}

function expectRenderedContent(
  instances: ApplicationInstance[],
  failure: string,
  assertion: () => void,
): void {
  try {
    assertion();
  } catch (error) {
    throw new Error(`${failure}:${formatApplicationLogs(instances)}`, { cause: error });
  }
}

function expectRenderedRouteDependencies(
  rendered: string,
  revision: string,
  title: string,
  instances: ApplicationInstance[],
): void {
  expectRenderedContent(
    instances,
    `Rendered route dependencies did not contain ${revision}`,
    () => {
      expect(rendered).toContain(`data-layout-revision="${revision}"`);
      expect(rendered).toContain(`data-page-revision="${revision}"`);
      expect(rendered).toContain(`<h2 class="text-2xl font-black tracking-tight">${title}</h2>`);
      expect(rendered).toContain(`<title>${title}</title>`);
    },
  );
}

async function expectSourceReads(
  contentServiceUrl: string,
  instances: ApplicationInstance[],
  reads: number,
  slug = "welcome",
): Promise<void> {
  let readCount: unknown;
  try {
    readCount = await ky
      .get(`${contentServiceUrl}/__test/read-count/reference/en/${slug}`, { retry: 0 })
      .json();
  } catch (error) {
    throw new Error(`Could not read the source count:${formatApplicationLogs(instances)}`, {
      cause: error,
    });
  }
  try {
    expect(readCount).toEqual({ reads });
  } catch (error) {
    throw new Error(
      `Expected ${reads} source reads for ${slug}:${formatApplicationLogs(instances)}`,
      {
        cause: error,
      },
    );
  }
}

async function pollForRenderedRevision(
  instance: ApplicationInstance,
  instances: ApplicationInstance[],
  revision: string,
  slug: string,
): Promise<string> {
  let rendered = "";
  await vi.waitFor(
    async () => {
      rendered = await getRenderedContent(instance, instances, `/cache-demo/${slug}`);
      expectRenderedRevision(rendered, revision, instances);
    },
    { interval: 50, timeout: 5_000 },
  );
  return rendered;
}

async function restartAndExpectSharedHit(
  instance: ApplicationInstance,
  restartedId: string,
  environment: ApplicationEnvironment,
  instances: ApplicationInstance[],
  revision: string,
): Promise<ApplicationInstance> {
  try {
    await stopProcess(instance.process);
    const restarted = await startTrackedApplication(restartedId, environment, instances);
    expectRenderedRevision(await getRenderedContent(restarted, instances), revision, instances);
    await waitForDiagnostic(restarted, "hit", instances);
    await expectSourceReads(environment.contentServiceUrl, instances, 1);
    return restarted;
  } catch (error) {
    throw new Error(
      `Restarted instance ${restartedId} did not reuse the shared entry:${formatApplicationLogs(instances)}`,
      { cause: error },
    );
  }
}

describe("two production Next.js instances with shared Redis cache reuse", () => {
  const contentService = createContentService();
  const applicationRuns: ApplicationInstance[] = [];
  let applicationA: ApplicationInstance | undefined;
  let applicationB: ApplicationInstance | undefined;
  let applicationEnvironment: ApplicationEnvironment;
  let container: StartedTestContainer;
  let contentServiceUrl: string;

  beforeAll(async () => {
    configureContainerRuntime();
    const { GenericContainer, Wait } = await import("testcontainers");
    container = await new GenericContainer("redis:8.2.1-alpine")
      .withExposedPorts(REDIS_PORT)
      .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
      .start();

    contentServiceUrl = await contentService.listen({ host: "127.0.0.1", port: 0 });
    await ky.post(`${contentServiceUrl}/__test/reset`, {
      json: {
        documents: [
          {
            body: "Redis-backed content",
            locale: "en",
            revision: "revision-1",
            site: "reference",
            slug: "welcome",
            title: "Published welcome",
          },
          {
            body: "Unrelated Redis-backed content",
            locale: "en",
            revision: "alpha-revision-1",
            site: "reference",
            slug: "alpha",
            title: "Published alpha",
          },
          {
            body: "Content that permits a brief stale response",
            locale: "en",
            revision: "beta-revision-1",
            site: "reference",
            slug: "beta",
            title: "Published beta",
          },
          {
            body: "Target page before path revalidation",
            locale: "en",
            revision: "path-target-page-1",
            site: "reference",
            slug: "path-target",
            title: "Target page revision 1",
          },
          {
            body: "Bystander page remains reusable",
            locale: "en",
            revision: "path-bystander-page-1",
            site: "reference",
            slug: "path-bystander",
            title: "Bystander page revision 1",
          },
        ],
      },
      retry: 0,
    });

    applicationEnvironment = {
      contentServiceUrl,
      namespace: `web-integration:${randomUUID()}`,
      revalidationSecret: `revalidation-test:${randomUUID()}`,
      redisUrl: `redis://${container.getHost()}:${container.getMappedPort(REDIS_PORT)}`,
    };
    applicationA = await startTrackedApplication(
      "instance-a",
      applicationEnvironment,
      applicationRuns,
    );
    applicationB = await startTrackedApplication(
      "instance-b",
      applicationEnvironment,
      applicationRuns,
    );
  }, 60_000);

  afterAll(async () => {
    const processCleanup = await Promise.allSettled(
      applicationRuns.map((instance) => stopProcess(instance.process)),
    );
    const serviceCleanup = await Promise.allSettled([contentService.close(), container?.stop()]);
    const errors = [...processCleanup, ...serviceCleanup].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Production scenario cleanup failed:${formatApplicationLogs(applicationRuns)}`,
      );
    }
  }, 30_000);

  it("shares fresh content, invalidates immediately, and refreshes permitted stale content", async () => {
    if (!applicationA || !applicationB) throw new Error("Applications did not start");
    const trace: string[] = [];

    try {
      expect(applicationA.process.pid).not.toBe(applicationB.process.pid);
      expectRenderedRevision(
        await getRenderedContent(applicationA, applicationRuns),
        "revision-1",
        applicationRuns,
      );
      trace.push("1. instance-a warmed revision-1");
      await waitForDiagnostic(applicationA, "miss", applicationRuns);
      await expectSourceReads(contentServiceUrl, applicationRuns, 1);

      expectRenderedRevision(
        await getRenderedContent(applicationB, applicationRuns),
        "revision-1",
        applicationRuns,
      );
      trace.push("2. instance-b reused revision-1");
      await waitForDiagnostic(applicationB, "hit", applicationRuns);
      await expectSourceReads(contentServiceUrl, applicationRuns, 1);

      applicationA = await restartAndExpectSharedHit(
        applicationA,
        "instance-a-restarted",
        applicationEnvironment,
        applicationRuns,
        "revision-1",
      );
      applicationB = await restartAndExpectSharedHit(
        applicationB,
        "instance-b-restarted",
        applicationEnvironment,
        applicationRuns,
        "revision-1",
      );

      expectRenderedRevision(
        await getRenderedContent(applicationA, applicationRuns, "/cache-demo/alpha"),
        "alpha-revision-1",
        applicationRuns,
      );
      await expectSourceReads(contentServiceUrl, applicationRuns, 1, "alpha");
      expectRenderedRevision(
        await getRenderedContent(applicationB, applicationRuns, "/cache-demo/alpha"),
        "alpha-revision-1",
        applicationRuns,
      );
      await expectSourceReads(contentServiceUrl, applicationRuns, 1, "alpha");

      await ky.put(`${contentServiceUrl}/__test/response-pauses/old-render`, {
        json: { locale: "en", site: "reference", slug: "welcome" },
        retry: 0,
      });
      expect(await invalidatePublishedDocument(applicationA, applicationEnvironment)).toEqual({
        revalidated: true,
      });
      trace.push("3. revision-1 expired to start the controlled old render");

      const oldRender = getRenderedContent(applicationA, applicationRuns);
      const reached = await ky
        .get(`${contentServiceUrl}/__test/response-pauses/old-render/reached`, {
          retry: 0,
        })
        .json<{ pauseId: string; revision: string }>();
      expect(reached).toEqual({ pauseId: "old-render", revision: "revision-1" });
      trace.push("4. instance-a captured revision-1 and paused");

      await ky.put(`${contentServiceUrl}/__test/documents/reference/en/welcome`, {
        json: {
          body: "Redis-backed content after publication",
          revision: "revision-2",
          title: "Published welcome revision 2",
        },
        retry: 0,
      });
      trace.push("5. content service committed revision-2");

      expect(await invalidatePublishedDocument(applicationB, applicationEnvironment)).toEqual({
        revalidated: true,
      });
      trace.push("6. instance-b invalidated revision-1 after revision-2 commit");

      const refreshedByB = await getRenderedContent(applicationB, applicationRuns);
      expectRenderedRevision(refreshedByB, "revision-2", applicationRuns);
      expect(refreshedByB).not.toContain("revision-1");
      trace.push("7. instance-b published revision-2 to the shared cache");
      await expectSourceReads(contentServiceUrl, applicationRuns, 3);

      await ky.post(`${contentServiceUrl}/__test/response-pauses/old-render/release`, {
        retry: 0,
      });
      const completedOldRender = await oldRender;
      expectRenderedRevision(completedOldRender, "revision-1", applicationRuns);
      trace.push("8. already-running instance-a request completed with revision-1");

      const refreshedByA = await getRenderedContent(applicationA, applicationRuns);
      expectRenderedRevision(refreshedByA, "revision-2", applicationRuns);
      expect(refreshedByA).not.toContain("revision-1");
      const stillCurrentOnB = await getRenderedContent(applicationB, applicationRuns);
      expectRenderedRevision(stillCurrentOnB, "revision-2", applicationRuns);
      expect(stillCurrentOnB).not.toContain("revision-1");
      trace.push("9. both instances reused revision-2 after the old completion");
      await expectSourceReads(contentServiceUrl, applicationRuns, 3);

      expectRenderedRevision(
        await getRenderedContent(applicationB, applicationRuns, "/cache-demo/alpha"),
        "alpha-revision-1",
        applicationRuns,
      );
      await expectSourceReads(contentServiceUrl, applicationRuns, 1, "alpha");

      expectRenderedRevision(
        await getRenderedContent(applicationA, applicationRuns, "/cache-demo/beta"),
        "beta-revision-1",
        applicationRuns,
      );
      expectRenderedRevision(
        await getRenderedContent(applicationB, applicationRuns, "/cache-demo/beta"),
        "beta-revision-1",
        applicationRuns,
      );
      await expectSourceReads(contentServiceUrl, applicationRuns, 1, "beta");
      trace.push("10. both instances reused fresh beta-revision-1");

      await ky.put(`${contentServiceUrl}/__test/documents/reference/en/beta`, {
        json: {
          body: "Content refreshed in the background",
          revision: "beta-revision-2",
          title: "Published beta revision 2",
        },
        retry: 0,
      });
      expect(
        await invalidatePublishedDocument(applicationA, applicationEnvironment, {
          policy: "stale-while-revalidate",
          slug: "beta",
        }),
      ).toEqual({ revalidated: true });
      trace.push("11. beta-revision-1 became stale under the brief SWR policy");

      expectRenderedRevision(
        await getRenderedContent(applicationB, applicationRuns, "/cache-demo/beta"),
        "beta-revision-1",
        applicationRuns,
      );
      trace.push("12. instance-b served stale beta-revision-1 while refreshing");
      expectRenderedRevision(
        await pollForRenderedRevision(applicationA, applicationRuns, "beta-revision-2", "beta"),
        "beta-revision-2",
        applicationRuns,
      );
      await expectSourceReads(contentServiceUrl, applicationRuns, 2, "beta");
      trace.push("13. instance-a reused refreshed beta-revision-2");
    } catch (error) {
      throw new Error(
        `Shared cache scenario failed after these ordered revision events:\n${trace.join("\n") || "<none>"}`,
        { cause: error },
      );
    }
  }, 60_000);

  it("revalidates every cached dependency for one path without invalidating another route", async () => {
    if (!applicationA || !applicationB) throw new Error("Applications did not start");

    const targetBefore = await getRenderedContent(
      applicationA,
      applicationRuns,
      "/path-cache-demo/path-target",
    );
    expectRenderedRouteDependencies(
      targetBefore,
      "path-target-page-1",
      "Target page revision 1",
      applicationRuns,
    );
    await expectSourceReads(contentServiceUrl, applicationRuns, 3, "path-target");

    const bystanderBefore = await getRenderedContent(
      applicationB,
      applicationRuns,
      "/path-cache-demo/path-bystander",
    );
    expectRenderedRouteDependencies(
      bystanderBefore,
      "path-bystander-page-1",
      "Bystander page revision 1",
      applicationRuns,
    );
    await expectSourceReads(contentServiceUrl, applicationRuns, 3, "path-bystander");

    for (const [slug, revision, title] of [
      ["path-target", "path-target-page-2", "Target page revision 2"],
      ["path-bystander", "path-bystander-page-2", "Bystander page revision 2"],
    ] as const) {
      await ky.put(`${contentServiceUrl}/__test/documents/reference/en/${slug}`, {
        json: { body: `Updated ${slug}`, revision, title },
        retry: 0,
      });
    }

    const actionResponse = await submitPathRevalidation(
      applicationA,
      applicationRuns,
      "path-target",
    );
    expectRenderedRouteDependencies(
      actionResponse,
      "path-target-page-2",
      "Target page revision 2",
      applicationRuns,
    );

    const targetOnB = await getRenderedContent(
      applicationB,
      applicationRuns,
      "/path-cache-demo/path-target",
    );
    expectRenderedRouteDependencies(
      targetOnB,
      "path-target-page-2",
      "Target page revision 2",
      applicationRuns,
    );
    await expectSourceReads(contentServiceUrl, applicationRuns, 9, "path-target");

    const targetAgainOnA = await getRenderedContent(
      applicationA,
      applicationRuns,
      "/path-cache-demo/path-target",
    );
    expectRenderedRouteDependencies(
      targetAgainOnA,
      "path-target-page-2",
      "Target page revision 2",
      applicationRuns,
    );
    await expectSourceReads(contentServiceUrl, applicationRuns, 9, "path-target");

    const bystanderAfter = await getRenderedContent(
      applicationA,
      applicationRuns,
      "/path-cache-demo/path-bystander",
    );
    expectRenderedRouteDependencies(
      bystanderAfter,
      "path-bystander-page-1",
      "Bystander page revision 1",
      applicationRuns,
    );
    expect(bystanderAfter).not.toContain("path-bystander-page-2");
    await expectSourceReads(contentServiceUrl, applicationRuns, 3, "path-bystander");
  }, 60_000);
});
