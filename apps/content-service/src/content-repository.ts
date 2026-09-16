import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PublicContentDimensions, PublishedDocument } from "./app.ts";

const localePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/u;
const pathSegmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function readDirectoryNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function assertDimension(value: string, pattern: RegExp, dimension: string): void {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${dimension} directory in Markdown content: ${value}`);
  }
}

function parseMarkdownDocument(
  filename: string,
  dimensions: PublicContentDimensions,
): PublishedDocument {
  const source = readFileSync(filename, "utf8").replaceAll("\r\n", "\n").trim();
  const [heading = "", ...bodyLines] = source.split("\n");
  const title = /^#\s+(.+?)\s*$/u.exec(heading)?.[1];
  const body = bodyLines.join("\n").trim();

  if (!title || body.length === 0) {
    throw new Error(
      `Markdown content must start with one H1 followed by a non-empty body: ${filename}`,
    );
  }

  const revision = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return { ...dimensions, body, revision: `sha256-${revision}`, title };
}

export function loadMarkdownDocuments(contentDirectory: URL): PublishedDocument[] {
  const root = fileURLToPath(contentDirectory);
  const documents: PublishedDocument[] = [];

  for (const site of readDirectoryNames(root)) {
    assertDimension(site, pathSegmentPattern, "site");
    const siteDirectory = path.join(root, site);

    for (const locale of readDirectoryNames(siteDirectory)) {
      assertDimension(locale, localePattern, "locale");
      const localeDirectory = path.join(siteDirectory, locale);
      const files = readdirSync(localeDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .toSorted();

      for (const file of files) {
        const slug = file.slice(0, -".md".length);
        assertDimension(slug, pathSegmentPattern, "slug");
        documents.push(
          parseMarkdownDocument(path.join(localeDirectory, file), { locale, site, slug }),
        );
      }
    }
  }

  return documents;
}
