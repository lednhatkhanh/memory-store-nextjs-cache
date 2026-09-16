import { createContentService } from "./app.ts";

const service = createContentService({ logger: true });
const port = Number.parseInt(process.env["PORT"] ?? "3100", 10);

try {
  await service.listen({ host: "0.0.0.0", port });
} catch (error: unknown) {
  service.log.error(error);
  process.exitCode = 1;
}
