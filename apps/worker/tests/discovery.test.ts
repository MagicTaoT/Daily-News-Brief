import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openNewsStore } from "@morning-signal/storage";
import { describe, expect, it } from "vitest";

import { importDiscoveryReport } from "../src/discovery.js";

function databasePath(): string {
  return join(mkdtempSync(join(tmpdir(), "morning-discovery-")), "test.db");
}

const report = {
  schema_version: "1.0",
  edition_date: "2026-09-15",
  timezone: "America/Los_Angeles",
  coverage: {
    start: "2026-09-14T13:30:00Z",
    end: "2026-09-15T13:30:00Z",
  },
  generated_at: "2026-09-15T13:00:00Z",
  model: "gpt-6-astra-low",
  queries: ["AI finance blockchain"],
  items: [
    {
      title: "A verified AI finance release",
      url: "https://example.com/releases/one",
      publisher: "Example Research",
      published_at: "2026-09-15T10:00:00Z",
      retrieved_at: "2026-09-15T13:00:00Z",
      topic: "ai_finance_crypto",
      summary:
        "The primary source published a verifiable finance agent update.",
      tier: 1,
    },
  ],
};

describe("ChatGPT discovery import", () => {
  it("imports traceable documents and remains idempotent", () => {
    const store = openNewsStore(databasePath());
    try {
      expect(importDiscoveryReport(store.repository, report)).toMatchObject({
        insertedDocuments: 1,
        duplicateDocuments: 0,
      });
      expect(importDiscoveryReport(store.repository, report)).toMatchObject({
        insertedDocuments: 0,
        duplicateDocuments: 1,
      });

      const documents = store.repository.listDocumentsForAnalysis(
        report.coverage.start,
        report.coverage.end,
      );
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({
        sourceName: "Example Research",
        sourceTier: 1,
        sourceTopics: ["ai_finance_crypto"],
      });
    } finally {
      store.close();
    }
  });

  it("rejects items outside the requested 24-hour window", () => {
    const store = openNewsStore(databasePath());
    try {
      expect(() =>
        importDiscoveryReport(store.repository, {
          ...report,
          items: [{ ...report.items[0], published_at: "2026-09-13T10:00:00Z" }],
        }),
      ).toThrow("published_at must fall inside");
    } finally {
      store.close();
    }
  });
});
