import { describe, expect, it, vi } from "vitest";

import { getContentServiceHealth, getPublishedDocument } from "../src/lib/content-client";

describe("content service HTTP client", () => {
  it("returns a typed health response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: "ok" })),
    );

    await expect(
      getContentServiceHealth("http://content-service.test/health", { fetch }),
    ).resolves.toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("surfaces an HTTP failure without retrying application requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: "unavailable" }, { status: 503 })),
    );

    await expect(
      getContentServiceHealth("http://content-service.test/health", { fetch }),
    ).rejects.toMatchObject({
      name: "HTTPError",
      response: { status: 503 },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads the published projection for validated public content dimensions", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(input).toBeInstanceOf(Request);
      if (!(input instanceof Request)) throw new Error("Expected Ky to issue a Request");
      expect(input.url).toBe("http://content-service.test/documents/acme/en/welcome");
      return Response.json({
        body: "Published body",
        locale: "en",
        revision: "revision-7",
        site: "acme",
        slug: "welcome",
        title: "Published title",
      });
    });

    await expect(
      getPublishedDocument(
        "http://content-service.test",
        { locale: "en", site: "acme", slug: "welcome" },
        { fetch },
      ),
    ).resolves.toMatchObject({ revision: "revision-7", title: "Published title" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects invalid public dimensions before making a source request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      getPublishedDocument(
        "http://content-service.test",
        { locale: "en", site: "acme", slug: "../preview" },
        { fetch },
      ),
    ).rejects.toThrow("Invalid public content slug");
    expect(fetch).not.toHaveBeenCalled();
  });
});
