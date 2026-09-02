import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SourcesConfigSchema,
  type FeedSource,
} from "@morning-signal/contracts";
import { openNewsStore } from "@morning-signal/storage";
import { afterEach, describe, expect, it } from "vitest";

import { collectFeeds, loadSourcesConfig, parseFeed } from "../src/index.js";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Feed</title>
    <item>
      <guid>new-item</guid>
      <title>New &amp; important MEV research</title>
      <link>https://example.com/research?utm_source=feed</link>
      <pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Auction evidence with <strong>new data</strong>.</p>]]></content:encoded>
    </item>
    <item>
      <guid>old-item</guid>
      <title>Old item</title>
      <link>https://example.com/old</link>
      <pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate>
      <description>Outside the collection horizon.</description>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release feed</title>
  <entry>
    <id>tag:example.com,2026:release-1</id>
    <title>Agent SDK v2</title>
    <updated>2026-09-01T10:00:00Z</updated>
    <author><name>Example Maintainer</name></author>
    <link rel="alternate" href="https://example.com/releases/2" />
    <content type="html">&lt;p&gt;Permission controls improved.&lt;/p&gt;</content>
  </entry>
</feed>`;

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "morning-signal-collector-"));
  temporaryDirectories.push(directory);
  return directory;
}

function source(
  id: string,
  feedUrl: string,
  format: "auto" | "rss" | "atom" = "auto",
): FeedSource {
  return {
    id,
    name: id,
    homepage_url: "https://example.com/",
    feed_url: feedUrl,
    tier: 1,
    kind: "rss",
    format,
    topics: ["mev"],
    enabled: true,
  };
}

function config(sources: FeedSource[]) {
  return SourcesConfigSchema.parse({
    schema_version: 1,
    defaults: {
      timeout_ms: 5_000,
      max_items: 20,
      max_age_days: 8,
      concurrency: 2,
      user_agent: "MorningSignal/Test",
    },
    sources,
  });
}

function advancingClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 8, 2, 12, 0, tick++));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("feed parsing", () => {
  it("loads and validates the checked-in source registry", () => {
    const loaded = loadSourcesConfig(
      fileURLToPath(new URL("../../../config/sources.yaml", import.meta.url)),
    );

    expect(loaded.sources).toHaveLength(10);
    expect(new Set(loaded.sources.map((item) => item.id)).size).toBe(10);
    expect(loaded.sources.every((item) => item.topics.length > 0)).toBe(true);
  });

  it("normalizes RSS content, dates and tracking URLs", () => {
    const items = parseFeed(
      rss,
      source("rss-source", "https://example.com/feed.xml", "rss"),
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "New & important MEV research",
      canonicalUrl: "https://example.com/research",
      publishedAt: "2026-09-01T12:00:00.000Z",
      body: "Auction evidence with new data .",
    });
  });

  it("normalizes Atom links, authors and HTML content", () => {
    const items = parseFeed(
      atom,
      source("atom-source", "https://example.com/releases.atom", "atom"),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Agent SDK v2",
      author: "Example Maintainer",
      url: "https://example.com/releases/2",
      body: "Permission controls improved.",
    });
  });
});

describe("collector pipeline", () => {
  it("stores recent items and raw snapshots, then uses conditional requests", async () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "news.db"));
    const feedSource = source(
      "rss-source",
      "https://example.com/feed.xml",
      "rss",
    );
    const seenEtags: Array<string | null> = [];
    let request = 0;
    const fetchImpl = (async (_input, init) => {
      request += 1;
      seenEtags.push(new Headers(init?.headers).get("if-none-match"));
      if (request === 3) {
        return new Response(null, { status: 304 });
      }
      return new Response(rss, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
          etag: '"feed-v1"',
          "last-modified": "Tue, 01 Sep 2026 12:00:00 GMT",
        },
      });
    }) as typeof fetch;
    const options = {
      config: config([feedSource]),
      repository: store.repository,
      dataDirectory: directory,
      fetchImpl,
      clock: advancingClock(),
    };

    const first = await collectFeeds(options);
    const second = await collectFeeds(options);
    const third = await collectFeeds(options);

    expect(first).toMatchObject({
      status: "completed",
      newDocumentCount: 1,
      filteredByAgeCount: 1,
    });
    expect(first.sources[0]?.rawPath).toBeTruthy();
    expect(
      existsSync(join(directory, first.sources[0]?.rawPath ?? "missing")),
    ).toBe(true);
    expect(second).toMatchObject({
      status: "completed",
      duplicateDocumentCount: 1,
    });
    expect(third).toMatchObject({
      status: "completed",
      notModifiedCount: 1,
    });
    expect(seenEtags).toEqual([null, '"feed-v1"', '"feed-v1"']);
    expect(store.repository.getStats()).toMatchObject({
      sources: 1,
      documents: 1,
      collectionRuns: 3,
    });
    expect(store.repository.getSourceFetchState("rss-source")).toMatchObject({
      etag: '"feed-v1"',
      consecutiveFailures: 0,
    });

    store.close();
  });

  it("isolates a failing source and records a partial run", async () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "news.db"));
    const good = source("good-source", "https://example.com/good.xml");
    const bad = source("bad-source", "https://example.com/bad.xml");
    const fetchImpl = (async (input) =>
      String(input).includes("bad")
        ? new Response("denied", { status: 403 })
        : new Response(rss, { status: 200 })) as typeof fetch;

    const result = await collectFeeds({
      config: config([good, bad]),
      repository: store.repository,
      dataDirectory: directory,
      fetchImpl,
      clock: advancingClock(),
    });

    expect(result).toMatchObject({
      status: "partial",
      sourceCount: 2,
      successCount: 1,
      failureCount: 1,
      newDocumentCount: 1,
    });
    expect(
      result.sources.find((item) => item.sourceId === "bad-source"),
    ).toMatchObject({
      status: "failed",
      httpStatus: 403,
    });
    expect(store.repository.getSourceFetchState("bad-source")).toMatchObject({
      consecutiveFailures: 1,
      lastError: "Feed request failed with HTTP 403.",
    });

    store.close();
  });

  it("makes dry-runs observable without writing local state", async () => {
    const directory = temporaryDirectory();
    const store = openNewsStore(join(directory, "news.db"));
    const result = await collectFeeds({
      config: config([
        source("dry-source", "https://example.com/dry.xml", "rss"),
      ]),
      repository: store.repository,
      dataDirectory: directory,
      dryRun: true,
      fetchImpl: (async () => new Response(rss)) as typeof fetch,
      clock: advancingClock(),
    });

    expect(result).toMatchObject({
      dryRun: true,
      newDocumentCount: 1,
    });
    expect(store.repository.getStats()).toMatchObject({
      sources: 0,
      documents: 0,
      collectionRuns: 0,
    });
    expect(existsSync(join(directory, "raw"))).toBe(false);

    store.close();
  });
});
