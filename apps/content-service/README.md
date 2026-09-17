# Markdown content service

The Fastify service exposes checked-in Markdown as a small, CMS-shaped published-content source.
Add documents at `content/<site>/<locale>/<slug>.md`. A document must start with one H1, which
becomes its title, followed by a non-empty Markdown body. The service derives a stable
`sha256-<12 hex characters>` revision from the file contents.

For example, `content/reference/en/welcome.md` is published at
`GET /documents/reference/en/welcome`. Restart the development service after editing a file. Use a
fresh Redis cache namespace, or the scenario's explicit invalidation mechanism once implemented,
when verifying a new revision through the Next.js cache.

The `__test` commit, read-count, and reset endpoints remain deterministic integration-test
facilities. A reset replaces the file-backed startup snapshot for the lifetime of that service
process; it does not write to disk.

Deterministic failure scenarios can mark one existing document unavailable with
`PUT /__test/source-failures/:site/:locale/:slug` and recover it with the matching `DELETE` request.
The public document route returns `503` while the fault is armed. Confirm a publication deletion
with `DELETE /__test/documents/:site/:locale/:slug`; subsequent public reads return `404`. Reset
clears all armed failures. Together with the response-pause barrier below, these controls provide
source failure, recovery, confirmed deletion, and deterministic delay without placing fault
injection in the reference application.

Race scenarios can arm `PUT /__test/response-pauses/:pauseId` with content dimensions. The next
matching document response captures its current revision, signals it through the long-polling
`GET /__test/response-pauses/:pauseId/reached` endpoint, and waits until
`POST /__test/response-pauses/:pauseId/release`. The response returns the captured document even if
a newer document is committed while it is paused. These barriers avoid timing sleeps and remain
test-only support-service controls.

Fastify capability extensions should start with the [Fastify ecosystem
catalog](https://fastify.dev/ecosystem/). Prefer a Fastify core feature, then an official plugin
maintained by the Fastify team. Add a community plugin only when no official option fits and record
the maintenance and compatibility rationale in `docs/dependency-policy.md`.
