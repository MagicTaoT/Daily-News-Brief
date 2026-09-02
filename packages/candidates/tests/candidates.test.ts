import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SourcesConfigSchema,
  type FeedSource,
} from "@morning-signal/contracts";
import {
  openNewsStore,
  type AnalysisDocument,
  type SourceTier,
} from "@morning-signal/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  editionWindow,
  clusterDocuments,
  loadProfile,
  prepareCandidates,
  topicEvidenceScore,
  titleSimilarity,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "morning-signal-candidates-"));
  temporaryDirectories.push(directory);
  return directory;
}

function profile() {
  return loadProfile(
    fileURLToPath(new URL("../../../config/profile.yaml", import.meta.url)),
  );
}

function feedSource(
  id: string,
  tier: SourceTier,
  topics: FeedSource["topics"],
): FeedSource {
  return {
    id,
    name: id,
    homepage_url: `https://${id}.example.com/`,
    feed_url: `https://${id}.example.com/feed.xml`,
    tier,
    kind: "rss",
    format: "rss",
    topics,
    enabled: true,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("edition windows", () => {
  it("converts the configured Los Angeles morning across daylight saving time", () => {
    const summer = editionWindow("2026-09-02", profile().config);
    const winter = editionWindow("2026-12-02", profile().config);

    expect(summer.end.toISOString()).toBe("2026-09-02T14:00:00.000Z");
    expect(summer.currentStart.toISOString()).toBe("2026-09-01T14:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2026-12-02T15:00:00.000Z");
  });
});

describe("conservative clustering", () => {
  it("matches short acronyms as words rather than arbitrary substrings", () => {
    const loadedProfile = profile().config;

    expect(
      topicEvidenceScore(
        "defi",
        "SEC and FDA Announce MOU",
        "The agencies will move forward with information sharing.",
        loadedProfile,
      ),
    ).toBe(0);
    expect(
      topicEvidenceScore(
        "defi",
        "Tokenization proposal adds RWA collateral",
        "The proposal concerns real world assets.",
        loadedProfile,
      ),
    ).toBeGreaterThan(0);
  });

  it("recognizes strong cross-source similarity without merging locations", () => {
    expect(
      titleSimilarity(
        "Protocol X pauses lending after oracle exploit",
        "Protocol X pauses lending following oracle exploit",
      ),
    ).toBeGreaterThan(0.68);
    expect(
      titleSimilarity(
        "Green forest fire notification in Zimbabwe",
        "Green forest fire notification in Mozambique",
      ),
    ).toBeGreaterThan(0.6);

    const base = {
      sourceId: "disaster-alerts",
      sourceName: "Disaster Alerts",
      sourceTier: 1 as const,
      author: null,
      publishedAt: "2026-09-02T02:00:00Z",
      retrievedAt: "2026-09-02T03:00:00Z",
      effectiveAt: "2026-09-02T02:00:00Z",
      language: "en",
      body: "A low-severity forest fire notification.",
      sourceTopics: ["black_swan" as const],
      existingEventId: null,
      canonicalUrl: null,
    };
    const documents: AnalysisDocument[] = [
      {
        ...base,
        id: "zimbabwe",
        title: "Green forest fire notification in Zimbabwe",
        url: "https://example.com/zimbabwe",
      },
      {
        ...base,
        id: "mozambique",
        title: "Green forest fire notification in Mozambique",
        url: "https://example.com/mozambique",
      },
    ];

    expect(clusterDocuments(documents, profile().config)).toHaveLength(2);
  });
});

describe("candidate preparation", () => {
  it("builds auditable 24-hour and catch-up candidates idempotently", () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "news.db"));
    const sources = [
      feedSource("official-security", 1, ["crypto_security"]),
      feedSource("security-research", 2, ["crypto_security"]),
      feedSource("governance-forum", 3, ["defi"]),
      feedSource("disaster-alerts", 1, ["black_swan"]),
    ];
    const sourceConfig = SourcesConfigSchema.parse({
      schema_version: 1,
      defaults: {
        timeout_ms: 5_000,
        max_items: 50,
        max_age_days: 8,
        concurrency: 2,
        user_agent: "MorningSignal/Test",
      },
      sources,
    });

    for (const source of sources) {
      store.repository.upsertSource({
        id: source.id,
        name: source.name,
        url: source.homepage_url,
        tier: source.tier,
        kind: "rss",
        metadata: { topics: source.topics },
      });
    }

    const documents = [
      {
        id: "doc-official-exploit",
        sourceId: "official-security",
        title: "Protocol X pauses lending after oracle exploit",
        body: "The protocol paused lending while an oracle exploit is investigated.",
        publishedAt: "2026-09-01T16:00:00Z",
        topics: ["crypto_security"],
      },
      {
        id: "doc-research-exploit",
        sourceId: "security-research",
        title: "Protocol X pauses lending following oracle exploit",
        body: "Independent researchers reproduced the oracle exploit.",
        publishedAt: "2026-09-01T17:00:00Z",
        topics: ["crypto_security"],
      },
      {
        id: "doc-catchup",
        sourceId: "governance-forum",
        title: "Aave proposal adds a new collateral asset",
        body: "A governance proposal would add a collateral asset.",
        publishedAt: "2026-08-29T12:00:00Z",
        topics: ["defi"],
      },
      {
        id: "doc-green-one",
        sourceId: "disaster-alerts",
        title: "Green forest fire notification in Zimbabwe",
        body: "A low-severity forest fire notification.",
        publishedAt: "2026-09-02T02:00:00Z",
        topics: ["black_swan"],
      },
      {
        id: "doc-green-two",
        sourceId: "disaster-alerts",
        title: "Green forest fire notification in Zimbabwe",
        body: "A second update to the low-severity forest fire notification.",
        publishedAt: "2026-09-02T03:00:00Z",
        topics: ["black_swan"],
      },
    ] as const;

    for (const document of documents) {
      store.repository.saveDocument({
        id: document.id,
        sourceId: document.sourceId,
        url: `https://news.example.com/${document.id}`,
        title: document.title,
        body: document.body,
        publishedAt: document.publishedAt,
        retrievedAt: "2026-09-02T05:00:00Z",
        contentHash: `sha256:${document.id}`,
        metadata: { sourceTopics: document.topics },
      });
    }

    const options = {
      repository: store.repository,
      profile: profile(),
      sources: sourceConfig,
      editionDate: "2026-09-02",
      dataDirectory: directory,
      clock: () => new Date("2026-09-02T06:00:00Z"),
    };
    const first = prepareCandidates(options);
    const eventUpdatesAfterFirst = Number(
      (
        store.database
          .prepare("SELECT COUNT(*) AS count FROM event_updates")
          .get() as { count: number }
      ).count,
    );
    const second = prepareCandidates(options);
    const eventUpdatesAfterSecond = Number(
      (
        store.database
          .prepare("SELECT COUNT(*) AS count FROM event_updates")
          .get() as { count: number }
      ).count,
    );

    expect(first.bundle.stats).toEqual({
      documents_considered: 5,
      event_clusters: 3,
      current_candidates: 1,
      catchup_candidates: 1,
      suppressed_candidates: 1,
    });
    expect(first.bundle.current_24h[0]).toMatchObject({
      topic: "crypto_security",
      verification_status: "confirmed",
      severity: "high",
      source_count: 2,
      selection_reason: "current_window",
    });
    expect(first.bundle.catch_up_7d[0]).toMatchObject({
      topic: "defi",
      verification_status: "unverified",
      selection_reason: "previously_missed",
    });
    expect(first.bundle.suppressed[0]).toMatchObject({
      reason: "low_severity_alert",
      headline: "Green forest fire notification in Zimbabwe",
    });
    expect(existsSync(join(directory, first.filePath))).toBe(true);
    expect(second.bundle.current_24h[0]?.event_id).toBe(
      first.bundle.current_24h[0]?.event_id,
    );
    expect(eventUpdatesAfterFirst).toBe(3);
    expect(eventUpdatesAfterSecond).toBe(3);
    expect(store.repository.getStats()).toMatchObject({
      events: 3,
      analysisBundles: 2,
    });

    store.close();
  });
});
