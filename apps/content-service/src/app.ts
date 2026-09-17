import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import { loadMarkdownDocuments } from "./content-repository.ts";

export type PublicContentDimensions = {
  locale: string;
  site: string;
  slug: string;
};

export type PublishedDocument = PublicContentDimensions & {
  body: string;
  revision: string;
  title: string;
};

type CommitDocumentBody = {
  body: string;
  revision: string;
  title: string;
};

type ResetBody = {
  documents: PublishedDocument[];
};

type ResponsePause = {
  dimensions: PublicContentDimensions;
  pauseId: string;
  reached: Promise<string>;
  release: Promise<void>;
  resolveReached: (revision: string) => void;
  resolveRelease: () => void;
  state: "armed" | "reached" | "released";
};

type ResponsePauseParameters = {
  pauseId: string;
};

export type ContentServiceOptions = Pick<FastifyServerOptions, "logger"> & {
  contentDirectory?: URL;
};

const defaultContentDirectory = new URL("../content/", import.meta.url);

const dimensionParametersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["site", "locale", "slug"],
  properties: {
    locale: { type: "string", pattern: "^[a-z]{2}(?:-[A-Z]{2})?$" },
    site: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
  },
} as const;

const commitDocumentBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["body", "revision", "title"],
  properties: {
    body: { type: "string", minLength: 1 },
    revision: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
  },
} as const;

const publishedDocumentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["body", "locale", "revision", "site", "slug", "title"],
  properties: {
    ...dimensionParametersSchema.properties,
    ...commitDocumentBodySchema.properties,
  },
} as const;

const responsePauseParametersSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pauseId"],
  properties: {
    pauseId: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
  },
} as const;

function documentKey(dimensions: PublicContentDimensions): string {
  return `${dimensions.site}:${dimensions.locale}:${dimensions.slug}`;
}

function createResponsePause(pauseId: string, dimensions: PublicContentDimensions): ResponsePause {
  const reached = Promise.withResolvers<string>();
  const release = Promise.withResolvers<void>();
  return {
    dimensions,
    pauseId,
    reached: reached.promise,
    release: release.promise,
    resolveReached: reached.resolve,
    resolveRelease: release.resolve,
    state: "armed",
  };
}

export function createContentService(
  options: ContentServiceOptions = { logger: false },
): FastifyInstance {
  const { contentDirectory = defaultContentDirectory, ...serverOptions } = options;
  const service = Fastify(serverOptions);
  const documents = new Map<string, PublishedDocument>(
    loadMarkdownDocuments(contentDirectory).map((document) => [documentKey(document), document]),
  );
  const readCounts = new Map<string, number>();
  const responsePauses = new Map<string, ResponsePause>();
  const sourceFailures = new Set<string>();

  service.get("/health", async () => ({ status: "ok" }));

  service.put<{ Body: CommitDocumentBody; Params: PublicContentDimensions }>(
    "/__test/documents/:site/:locale/:slug",
    {
      schema: {
        body: commitDocumentBodySchema,
        params: dimensionParametersSchema,
      },
    },
    async (request) => {
      const document = { ...request.params, ...request.body };
      documents.set(documentKey(request.params), document);
      return document;
    },
  );

  service.delete<{ Params: PublicContentDimensions }>(
    "/__test/documents/:site/:locale/:slug",
    { schema: { params: dimensionParametersSchema } },
    async (request) => ({ deleted: documents.delete(documentKey(request.params)) }),
  );

  service.put<{ Params: PublicContentDimensions }>(
    "/__test/source-failures/:site/:locale/:slug",
    { schema: { params: dimensionParametersSchema } },
    async (request) => {
      sourceFailures.add(documentKey(request.params));
      return { failing: true };
    },
  );

  service.delete<{ Params: PublicContentDimensions }>(
    "/__test/source-failures/:site/:locale/:slug",
    { schema: { params: dimensionParametersSchema } },
    async (request) => {
      sourceFailures.delete(documentKey(request.params));
      return { recovered: true };
    },
  );

  service.put<{ Body: PublicContentDimensions; Params: ResponsePauseParameters }>(
    "/__test/response-pauses/:pauseId",
    {
      schema: {
        body: dimensionParametersSchema,
        params: responsePauseParametersSchema,
      },
    },
    async (request, reply) => {
      if (responsePauses.has(request.params.pauseId)) {
        return reply.code(409).send({ message: "Response pause already exists" });
      }
      responsePauses.set(
        request.params.pauseId,
        createResponsePause(request.params.pauseId, request.body),
      );
      return { armed: true };
    },
  );

  service.get<{ Params: ResponsePauseParameters }>(
    "/__test/response-pauses/:pauseId/reached",
    { schema: { params: responsePauseParametersSchema } },
    async (request, reply) => {
      const pause = responsePauses.get(request.params.pauseId);
      if (!pause) {
        return reply.code(404).send({ message: "Response pause not found" });
      }
      return { pauseId: pause.pauseId, revision: await pause.reached };
    },
  );

  service.post<{ Params: ResponsePauseParameters }>(
    "/__test/response-pauses/:pauseId/release",
    { schema: { params: responsePauseParametersSchema } },
    async (request, reply) => {
      const pause = responsePauses.get(request.params.pauseId);
      if (!pause) {
        return reply.code(404).send({ message: "Response pause not found" });
      }
      pause.state = "released";
      pause.resolveRelease();
      return { released: true };
    },
  );

  service.get<{ Params: PublicContentDimensions }>(
    "/documents/:site/:locale/:slug",
    { schema: { params: dimensionParametersSchema } },
    async (request, reply) => {
      const key = documentKey(request.params);
      const document = documents.get(key);
      if (!document) {
        return reply.code(404).send({ message: "Published document not found" });
      }

      readCounts.set(key, (readCounts.get(key) ?? 0) + 1);
      if (sourceFailures.has(key)) {
        return reply.code(503).send({ message: "Published content source unavailable" });
      }
      let pause: ResponsePause | undefined;
      for (const candidate of responsePauses.values()) {
        if (candidate.state === "armed" && documentKey(candidate.dimensions) === key) {
          pause = candidate;
          break;
        }
      }
      if (pause) {
        pause.state = "reached";
        pause.resolveReached(document.revision);
        await pause.release;
      }
      return document;
    },
  );

  service.get<{ Params: PublicContentDimensions }>(
    "/__test/read-count/:site/:locale/:slug",
    { schema: { params: dimensionParametersSchema } },
    async (request) => ({ reads: readCounts.get(documentKey(request.params)) ?? 0 }),
  );

  service.post<{ Body: ResetBody }>(
    "/__test/reset",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["documents"],
          properties: {
            documents: { type: "array", items: publishedDocumentSchema },
          },
        },
      },
    },
    async (request) => {
      for (const pause of responsePauses.values()) {
        pause.resolveRelease();
      }
      responsePauses.clear();
      sourceFailures.clear();
      documents.clear();
      readCounts.clear();
      for (const document of request.body.documents) {
        documents.set(documentKey(document), document);
      }
      return { reset: true };
    },
  );

  return service;
}
