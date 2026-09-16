import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  parseDiscoveryReport,
  type DiscoveryReport,
} from "@morning-signal/contracts";
import type { NewsRepository, SourceTier } from "@morning-signal/storage";

export interface DiscoveryImportSummary {
  editionDate: string;
  model: string;
  itemCount: number;
  insertedDocuments: number;
  duplicateDocuments: number;
  sourceCount: number;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceId(url: string): string {
  const host = new URL(url).hostname.toLocaleLowerCase().replace(/^www\./u, "");
  const slug = host.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `discovery-${slug}`.slice(0, 100);
}

export function loadDiscoveryReport(path: string): DiscoveryReport {
  return parseDiscoveryReport(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
}

export function importDiscoveryReport(
  repository: NewsRepository,
  reportValue: unknown,
): DiscoveryImportSummary {
  const report = parseDiscoveryReport(reportValue);
  const sourceIds = new Set<string>();
  let insertedDocuments = 0;
  let duplicateDocuments = 0;

  for (const item of report.items) {
    const id = sourceId(item.url);
    const origin = new URL(item.url).origin;
    sourceIds.add(id);
    repository.upsertSource({
      id,
      name: item.publisher,
      url: origin,
      tier: item.tier as SourceTier,
      kind: "website",
      metadata: {
        discoveredBy: "codex-local",
        discoveryModel: report.model,
      },
    });

    const saved = repository.saveDocument({
      id: `discovery-${digest(item.url).slice(0, 24)}`,
      sourceId: id,
      url: item.url,
      canonicalUrl: item.url,
      title: item.title,
      author: item.author ?? null,
      publishedAt: item.published_at,
      retrievedAt: item.retrieved_at,
      language: null,
      body: item.summary,
      contentHash: digest(`${item.url}\n${item.title}\n${item.summary}`),
      metadata: {
        sourceTopics: [item.topic],
        discoveredBy: "codex-local",
        discoveryModel: report.model,
        discoveryEditionDate: report.edition_date,
      },
    });
    if (saved.inserted) {
      insertedDocuments += 1;
    } else {
      duplicateDocuments += 1;
    }
  }

  return {
    editionDate: report.edition_date,
    model: report.model,
    itemCount: report.items.length,
    insertedDocuments,
    duplicateDocuments,
    sourceCount: sourceIds.size,
  };
}
