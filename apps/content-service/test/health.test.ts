import { afterEach, describe, expect, it } from "vitest";

import { createContentService } from "../src/app.ts";

describe("content service HTTP seam", () => {
  const services: Array<ReturnType<typeof createContentService>> = [];

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.close()));
  });

  it("reports readiness through its public health endpoint", async () => {
    const service = createContentService();
    services.push(service);

    const response = await service.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("publishes checked-in Markdown by site, locale, and slug", async () => {
    const service = createContentService();
    services.push(service);

    const response = await service.inject({
      method: "GET",
      url: "/documents/reference/en/alpha",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      body: expect.stringContaining("## What this demonstrates"),
      locale: "en",
      revision: expect.stringMatching(/^sha256-[a-f0-9]{12}$/u),
      site: "reference",
      slug: "alpha",
      title: "Alpha field note",
    });
  });

  it("commits and reads a revisioned public document while counting source reads", async () => {
    const service = createContentService();
    services.push(service);

    const commitResponse = await service.inject({
      method: "PUT",
      url: "/__test/documents/acme/en/welcome",
      payload: {
        body: "Published body",
        revision: "revision-7",
        title: "Published title",
      },
    });
    expect(commitResponse.statusCode).toBe(200);

    const readResponse = await service.inject({
      method: "GET",
      url: "/documents/acme/en/welcome",
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.json()).toEqual({
      body: "Published body",
      locale: "en",
      revision: "revision-7",
      site: "acme",
      slug: "welcome",
      title: "Published title",
    });

    const countResponse = await service.inject({
      method: "GET",
      url: "/__test/read-count/acme/en/welcome",
    });
    expect(countResponse.statusCode).toBe(200);
    expect(countResponse.json()).toEqual({ reads: 1 });
  });

  it("resets documents and read counts to a deterministic state", async () => {
    const service = createContentService();
    services.push(service);

    await service.inject({
      method: "PUT",
      url: "/__test/documents/acme/en/welcome",
      payload: { body: "Old body", revision: "revision-1", title: "Old title" },
    });
    await service.inject({ method: "GET", url: "/documents/acme/en/welcome" });

    const resetResponse = await service.inject({
      method: "POST",
      url: "/__test/reset",
      payload: {
        documents: [
          {
            body: "Reset body",
            locale: "en",
            revision: "revision-2",
            site: "acme",
            slug: "welcome",
            title: "Reset title",
          },
        ],
      },
    });
    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json()).toEqual({ reset: true });

    const countResponse = await service.inject({
      method: "GET",
      url: "/__test/read-count/acme/en/welcome",
    });
    expect(countResponse.json()).toEqual({ reads: 0 });

    const readResponse = await service.inject({
      method: "GET",
      url: "/documents/acme/en/welcome",
    });
    expect(readResponse.json()).toMatchObject({ revision: "revision-2" });
  });

  it("pauses a selected response after capturing its revision", async () => {
    const service = createContentService();
    services.push(service);

    await service.inject({
      method: "PUT",
      url: "/__test/documents/acme/en/welcome",
      payload: { body: "Old body", revision: "revision-1", title: "Old title" },
    });
    const armResponse = await service.inject({
      method: "PUT",
      url: "/__test/response-pauses/old-render",
      payload: { locale: "en", site: "acme", slug: "welcome" },
    });
    expect(armResponse.statusCode).toBe(200);

    const pausedRead = service.inject({
      method: "GET",
      url: "/documents/acme/en/welcome",
    });
    const reachedResponse = await service.inject({
      method: "GET",
      url: "/__test/response-pauses/old-render/reached",
    });
    expect(reachedResponse.statusCode).toBe(200);
    expect(reachedResponse.json()).toEqual({
      pauseId: "old-render",
      revision: "revision-1",
    });

    await service.inject({
      method: "PUT",
      url: "/__test/documents/acme/en/welcome",
      payload: { body: "New body", revision: "revision-2", title: "New title" },
    });
    const releaseResponse = await service.inject({
      method: "POST",
      url: "/__test/response-pauses/old-render/release",
    });
    expect(releaseResponse.json()).toEqual({ released: true });

    expect((await pausedRead).json()).toMatchObject({ revision: "revision-1" });
    const currentRead = await service.inject({
      method: "GET",
      url: "/documents/acme/en/welcome",
    });
    expect(currentRead.json()).toMatchObject({ revision: "revision-2" });
  });
});
