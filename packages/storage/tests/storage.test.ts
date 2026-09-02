import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { applyMigrations, openNewsStore } from "../src/index.js";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "morning-signal-storage-"));
  temporaryDirectories.push(directory);
  return join(directory, "test.db");
}

function exampleEdition(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("../../../examples/edition.example.json", import.meta.url),
      "utf8",
    ),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite storage", () => {
  it("applies migrations repeatedly without changing the schema", () => {
    const store = openNewsStore(temporaryDatabasePath());

    expect(store.migrations.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(applyMigrations(store.database)).toEqual(store.migrations);
    expect(store.repository.getStats()).toEqual({
      sources: 0,
      documents: 0,
      events: 0,
      editions: 0,
      feedback: 0,
      collectionRuns: 0,
      analysisBundles: 0,
      latestEditionDate: null,
    });

    store.close();
  });

  it("deduplicates documents and keeps their event provenance searchable", () => {
    const store = openNewsStore(temporaryDatabasePath());
    const repository = store.repository;

    repository.upsertSource({
      id: "flashbots",
      name: "Flashbots",
      url: "https://www.flashbots.net/",
      tier: 1,
      kind: "website",
    });

    const firstDocument = repository.saveDocument({
      id: "doc-mev-1",
      sourceId: "flashbots",
      url: "https://example.com/mev-auction",
      title: "New MEV auction design",
      retrievedAt: "2026-09-01T12:00:00Z",
      publishedAt: "2026-09-01T11:00:00Z",
      language: "en",
      body: "A proposed auction changes how order flow is allocated.",
      contentHash: "sha256:document-one",
    });
    const duplicateDocument = repository.saveDocument({
      id: "doc-mev-duplicate",
      sourceId: "flashbots",
      url: "https://example.com/mev-auction-copy",
      title: "Copied MEV auction design",
      retrievedAt: "2026-09-01T12:01:00Z",
      body: "A proposed auction changes how order flow is allocated.",
      contentHash: "sha256:document-one",
    });

    repository.upsertEvent({
      id: "event-mev-auction",
      topic: "mev",
      headline: "MEV auction design changes order-flow allocation",
      summary: "The design could shift value between builders and searchers.",
      verificationStatus: "confirmed",
      firstSeenAt: "2026-09-01T11:00:00Z",
      lastUpdatedAt: "2026-09-01T12:00:00Z",
    });
    repository.linkEventDocument("event-mev-auction", "doc-mev-1");
    repository.addEventUpdate({
      eventId: "event-mev-auction",
      observedAt: "2026-09-01T12:30:00Z",
      updateType: "confirmed",
      summary: "Primary documentation is now available.",
      sourceCount: 2,
    });

    expect(firstDocument).toEqual({ id: "doc-mev-1", inserted: true });
    expect(duplicateDocument).toEqual({ id: "doc-mev-1", inserted: false });
    expect(repository.searchEvents("MEV auction")).toHaveLength(1);
    expect(repository.searchEvents('MEV " auction')[0]).toMatchObject({
      id: "event-mev-auction",
      topic: "mev",
    });
    expect(repository.getStats()).toMatchObject({
      sources: 1,
      documents: 1,
      events: 1,
    });

    store.close();
  });

  it("reads the latest edition by date and protects published history", () => {
    const store = openNewsStore(temporaryDatabasePath());
    const repository = store.repository;
    const draft = exampleEdition() as Record<string, unknown>;

    repository.saveEdition(draft);
    expect(repository.getEditionByDate("2026-09-01")).toMatchObject({
      edition_id: "2026-09-01-daniel-default-v1",
      status: "review_required",
    });

    const published = {
      ...draft,
      status: "published",
      published_at: "2026-09-01T14:15:00Z",
    };
    repository.saveEdition(published);

    expect(() =>
      repository.saveEdition({
        ...published,
        executive_summary: "A silent overwrite must fail.",
      }),
    ).toThrow("immutable");
    expect(() =>
      store.database
        .prepare("UPDATE editions SET payload_json = '{}' WHERE edition_id = ?")
        .run("2026-09-01-daniel-default-v1"),
    ).toThrow("published editions are immutable");

    const revised = {
      ...published,
      edition_id: "2026-09-01-daniel-default-v2",
      status: "revised",
      executive_summary: "A visible second revision.",
      revision: {
        number: 2,
        revised_at: "2026-09-01T15:00:00Z",
        reason: "A primary source corrected its figures.",
      },
    };
    repository.saveEdition(revised);

    expect(repository.getEditionByDate("2026-09-01")).toMatchObject({
      edition_id: "2026-09-01-daniel-default-v2",
      status: "revised",
      revision: { number: 2 },
    });
    expect(repository.listEditions()).toHaveLength(2);

    const feedbackId = repository.addFeedback({
      editionId: "2026-09-01-daniel-default-v2",
      itemId: "story-example-001",
      action: "useful",
    });
    expect(feedbackId).toBeTruthy();
    expect(repository.getStats()).toMatchObject({
      editions: 2,
      feedback: 1,
      latestEditionDate: "2026-09-01",
    });

    store.close();
  });

  it("can require a new edition so scheduled imports cannot overwrite review work", () => {
    const store = openNewsStore(temporaryDatabasePath());
    const repository = store.repository;
    const draft = exampleEdition();

    repository.saveEdition(draft, { createOnly: true });

    expect(() => repository.saveEdition(draft, { createOnly: true })).toThrow(
      "refusing to overwrite an existing draft",
    );
    expect(repository.listEditions()).toHaveLength(1);

    store.close();
  });
});
