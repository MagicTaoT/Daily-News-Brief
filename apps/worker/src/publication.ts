import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseEdition, type Edition } from "@morning-signal/contracts";
import type { EditionSummary, NewsStore } from "@morning-signal/storage";

export interface PublicExportSummary {
  generatedAt: string;
  editionCount: number;
  latestEditionDate: string | null;
  outputDirectory: string;
}

function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function latestSummariesByDate(summaries: EditionSummary[]): EditionSummary[] {
  const seen = new Set<string>();
  return summaries.filter((summary) => {
    if (seen.has(summary.editionDate)) {
      return false;
    }
    seen.add(summary.editionDate);
    return true;
  });
}

export function publishEdition(
  store: NewsStore,
  editionDate: string,
  publishedAt = new Date().toISOString(),
): Edition {
  const current = store.repository.getEditionByDate(editionDate);
  if (!current) {
    throw new Error(`No edition exists for ${editionDate}.`);
  }

  if (current.status === "published" || current.status === "revised") {
    return current;
  }

  if (current.status !== "review_required" && current.status !== "approved") {
    throw new Error(
      `Edition ${editionDate} cannot be published from status ${current.status}.`,
    );
  }

  const published = parseEdition({
    ...current,
    status: "published",
    published_at: publishedAt,
  });
  const saved = store.repository.saveEdition(published);
  store.database
    .prepare(
      `UPDATE runs SET
        status = 'completed', stage = 'published', completed_at = ?
       WHERE id = ?`,
    )
    .run(publishedAt, saved.run_id);
  return saved;
}

export function publishAllApprovedEditions(
  store: NewsStore,
  publishedAt = new Date().toISOString(),
): Edition[] {
  const summaries = latestSummariesByDate(store.repository.listEditions(365));
  const published: Edition[] = [];

  for (const summary of summaries.reverse()) {
    if (summary.status === "approved") {
      published.push(publishEdition(store, summary.editionDate, publishedAt));
    }
  }

  return published;
}

export function exportPublishedEditions(
  store: NewsStore,
  outputDirectory: string,
  generatedAt?: string,
): PublicExportSummary {
  const summaries = latestSummariesByDate(store.repository.listEditions(365));
  const publicSummaries: EditionSummary[] = [];

  for (const summary of summaries) {
    const edition = store.repository.getEditionByDate(summary.editionDate);
    if (
      !edition ||
      (edition.status !== "published" && edition.status !== "revised")
    ) {
      continue;
    }

    const publicSummary: EditionSummary = {
      editionId: edition.edition_id,
      editionDate: edition.edition_date,
      profileVersion: edition.profile_version,
      status: edition.status,
      generatedAt: edition.generated_at,
      publishedAt: edition.published_at,
      revisionNumber: edition.revision?.number ?? 1,
    };
    publicSummaries.push(publicSummary);
    writeJsonAtomically(
      join(outputDirectory, "editions", `${edition.edition_date}.json`),
      { edition },
    );
  }

  const effectiveGeneratedAt =
    generatedAt ?? publicSummaries[0]?.publishedAt ?? new Date().toISOString();
  writeJsonAtomically(join(outputDirectory, "index.json"), {
    generatedAt: effectiveGeneratedAt,
    editions: publicSummaries,
  });

  return {
    generatedAt: effectiveGeneratedAt,
    editionCount: publicSummaries.length,
    latestEditionDate: publicSummaries[0]?.editionDate ?? null,
    outputDirectory,
  };
}
