import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Edition } from "@morning-signal/contracts";
import { openNewsStore } from "@morning-signal/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  exportPublishedEditions,
  publishAllApprovedEditions,
  publishEdition,
} from "../src/publication.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "morning-signal-publication-"));
  temporaryDirectories.push(directory);
  return directory;
}

function exampleEdition(): Edition {
  return JSON.parse(
    readFileSync(
      new URL("../../../examples/edition.example.json", import.meta.url),
      "utf8",
    ),
  ) as Edition;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("public edition export", () => {
  it("publishes a validated draft and exports only the public edition payload", () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "test.db"));
    store.repository.saveEdition(exampleEdition());

    const publishedAt = "2026-09-02T14:00:00.000Z";
    const published = publishEdition(store, "2026-09-01", publishedAt);
    const summary = exportPublishedEditions(
      store,
      join(directory, "public"),
      publishedAt,
    );
    const index = JSON.parse(
      readFileSync(join(directory, "public", "index.json"), "utf8"),
    ) as { editions: Array<{ status: string }> };
    const detail = JSON.parse(
      readFileSync(
        join(directory, "public", "editions", "2026-09-01.json"),
        "utf8",
      ),
    ) as { edition: Edition };

    expect(published).toMatchObject({
      status: "published",
      published_at: publishedAt,
    });
    expect(summary).toMatchObject({
      editionCount: 1,
      latestEditionDate: "2026-09-01",
    });
    expect(index.editions).toEqual([
      expect.objectContaining({ status: "published" }),
    ]);
    expect(detail.edition).toMatchObject({
      edition_id: "2026-09-01-daniel-default-v1",
      status: "published",
    });
    expect(JSON.stringify(detail)).not.toContain("document_metadata_json");
    store.close();
  });

  it("does not auto-publish an edition that needs attention", () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "test.db"));
    store.repository.saveEdition({
      ...exampleEdition(),
      status: "needs_attention",
    });

    expect(() => publishEdition(store, "2026-09-01")).toThrow(
      "cannot be published",
    );
    store.close();
  });

  it("backfills only editions that were already approved", () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "test.db"));
    const approved = {
      ...exampleEdition(),
      status: "approved" as const,
    };
    const reviewRequired = {
      ...exampleEdition(),
      edition_id: "2026-09-02-daniel-default-v1",
      edition_date: "2026-09-02",
    };
    store.repository.saveEdition(approved);
    store.repository.saveEdition(reviewRequired);

    expect(
      publishAllApprovedEditions(store, "2026-09-03T14:00:00.000Z"),
    ).toHaveLength(1);
    expect(store.repository.getEditionByDate("2026-09-01")?.status).toBe(
      "published",
    );
    expect(store.repository.getEditionByDate("2026-09-02")?.status).toBe(
      "review_required",
    );
    store.close();
  });
});
