import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { FeedSource, SourcesConfig } from "@morning-signal/contracts";
import type { NewsRepository } from "@morning-signal/storage";

import { parseFeed } from "./feed.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface SourceCollectionResult {
  sourceId: string;
  status: "success" | "not_modified" | "failed";
  httpStatus: number | null;
  rawPath: string | null;
  itemsSeen: number;
  newDocuments: number;
  duplicateDocuments: number;
  filteredByAge: number;
  error: string | null;
  startedAt: string;
  completedAt: string;
}

export interface CollectionSummary {
  runId: string;
  status: "completed" | "partial" | "failed";
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  successCount: number;
  failureCount: number;
  notModifiedCount: number;
  newDocumentCount: number;
  duplicateDocumentCount: number;
  filteredByAgeCount: number;
  sources: SourceCollectionResult[];
}

export interface CollectOptions {
  config: SourcesConfig;
  repository: NewsRepository;
  dataDirectory: string;
  sourceIds?: string[];
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Feed request failed with HTTP ${status}.`);
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, " ").slice(0, 500);
}

async function responseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Feed response exceeded the 5 MiB size limit.");
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Feed response exceeded the 5 MiB size limit.");
  }
  return new TextDecoder().decode(buffer);
}

function writeRawSnapshot(
  dataDirectory: string,
  sourceId: string,
  fetchedAt: Date,
  body: string,
): string {
  const date = fetchedAt.toISOString().slice(0, 10);
  const directory = join(dataDirectory, "raw", date, sourceId);
  mkdirSync(directory, { recursive: true });
  const timestamp = fetchedAt.toISOString().replaceAll(":", "-");
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const path = join(directory, `${timestamp}-${digest}.xml`);
  writeFileSync(path, body, { encoding: "utf8", flag: "wx" });
  return relative(dataDirectory, path);
}

async function fetchOnce(
  source: FeedSource,
  config: SourcesConfig,
  repository: NewsRepository,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const state = repository.getSourceFetchState(source.id);
  const headers = new Headers({
    Accept:
      "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9",
    "User-Agent": config.defaults.user_agent,
  });
  if (state?.etag) {
    headers.set("If-None-Match", state.etag);
  }
  if (state?.lastModified) {
    headers.set("If-Modified-Since", state.lastModified);
  }

  return fetchImpl(source.feed_url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(
      source.timeout_ms ?? config.defaults.timeout_ms,
    ),
  });
}

async function fetchWithOneRetry(
  source: FeedSource,
  config: SourcesConfig,
  repository: NewsRepository,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchOnce(source, config, repository, fetchImpl);
      if (response.status === 304 || response.ok) {
        return response;
      }
      if (response.status < 500 && response.status !== 429) {
        throw new HttpStatusError(response.status);
      }
      lastError = new HttpStatusError(response.status);
    } catch (error) {
      if (error instanceof HttpStatusError && error.status < 500) {
        throw error;
      }
      lastError = error;
    }

    if (attempt === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Feed request failed.");
}

function selectSources(
  config: SourcesConfig,
  requestedIds: string[] | undefined,
): FeedSource[] {
  if (!requestedIds || requestedIds.length === 0) {
    return config.sources.filter((source) => source.enabled);
  }

  const requested = new Set(requestedIds);
  const unknown = [...requested].filter(
    (id) => !config.sources.some((source) => source.id === id),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown source id: ${unknown.join(", ")}`);
  }

  return config.sources.filter(
    (source) => source.enabled && requested.has(source.id),
  );
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await operation(item);
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function collectSource(
  source: FeedSource,
  options: Required<
    Pick<CollectOptions, "config" | "repository" | "dataDirectory">
  > & {
    dryRun: boolean;
    fetchImpl: typeof fetch;
    clock: () => Date;
    runId: string;
  },
): Promise<SourceCollectionResult> {
  const startedAt = options.clock().toISOString();
  let httpStatus: number | null = null;
  let rawPath: string | null = null;

  try {
    const response = await fetchWithOneRetry(
      source,
      options.config,
      options.repository,
      options.fetchImpl,
    );
    httpStatus = response.status;

    if (response.status === 304) {
      const completedAt = options.clock().toISOString();
      const result: SourceCollectionResult = {
        sourceId: source.id,
        status: "not_modified",
        httpStatus,
        rawPath: null,
        itemsSeen: 0,
        newDocuments: 0,
        duplicateDocuments: 0,
        filteredByAge: 0,
        error: null,
        startedAt,
        completedAt,
      };
      if (!options.dryRun) {
        options.repository.markSourceFetchSuccess({
          sourceId: source.id,
          attemptedAt: completedAt,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        });
        options.repository.recordCollectionAttempt({
          collectionRunId: options.runId,
          sourceId: source.id,
          status: result.status,
          startedAt,
          completedAt,
          httpStatus,
        });
      }
      return result;
    }

    const body = await responseText(response);
    const fetchedAt = options.clock();
    if (!options.dryRun) {
      rawPath = writeRawSnapshot(
        options.dataDirectory,
        source.id,
        fetchedAt,
        body,
      );
    }

    const parsedItems = parseFeed(body, source);
    const cutoff =
      fetchedAt.getTime() - options.config.defaults.max_age_days * 86_400_000;
    const recentItems = parsedItems.filter(
      (item) =>
        item.publishedAt === null || Date.parse(item.publishedAt) >= cutoff,
    );
    const limitedItems = recentItems.slice(
      0,
      source.max_items ?? options.config.defaults.max_items,
    );
    let newDocuments = 0;
    let duplicateDocuments = 0;

    if (!options.dryRun) {
      for (const item of limitedItems) {
        const saved = options.repository.saveDocument({
          id: item.id,
          sourceId: source.id,
          url: item.url,
          canonicalUrl: item.canonicalUrl,
          title: item.title,
          author: item.author,
          publishedAt: item.publishedAt,
          retrievedAt: fetchedAt.toISOString(),
          body: item.body,
          contentHash: item.contentHash,
          rawPath,
          metadata: {
            sourceItemId: item.sourceItemId,
            sourceTopics: source.topics,
          },
        });
        if (saved.inserted) {
          newDocuments += 1;
        } else {
          duplicateDocuments += 1;
        }
      }
    } else {
      newDocuments = limitedItems.length;
    }

    const completedAt = options.clock().toISOString();
    const result: SourceCollectionResult = {
      sourceId: source.id,
      status: "success",
      httpStatus,
      rawPath,
      itemsSeen: parsedItems.length,
      newDocuments,
      duplicateDocuments,
      filteredByAge: parsedItems.length - recentItems.length,
      error: null,
      startedAt,
      completedAt,
    };

    if (!options.dryRun) {
      options.repository.markSourceFetchSuccess({
        sourceId: source.id,
        attemptedAt: completedAt,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      });
      options.repository.recordCollectionAttempt({
        collectionRunId: options.runId,
        sourceId: source.id,
        status: result.status,
        startedAt,
        completedAt,
        httpStatus,
        rawPath,
        itemsSeen: result.itemsSeen,
        newDocumentCount: result.newDocuments,
        duplicateDocumentCount: result.duplicateDocuments,
      });
    }
    return result;
  } catch (error) {
    if (error instanceof HttpStatusError) {
      httpStatus = error.status;
    }
    const completedAt = options.clock().toISOString();
    const message = safeError(error);
    const result: SourceCollectionResult = {
      sourceId: source.id,
      status: "failed",
      httpStatus,
      rawPath,
      itemsSeen: 0,
      newDocuments: 0,
      duplicateDocuments: 0,
      filteredByAge: 0,
      error: message,
      startedAt,
      completedAt,
    };

    if (!options.dryRun) {
      options.repository.markSourceFetchFailure({
        sourceId: source.id,
        attemptedAt: completedAt,
        error: message,
      });
      options.repository.recordCollectionAttempt({
        collectionRunId: options.runId,
        sourceId: source.id,
        status: result.status,
        startedAt,
        completedAt,
        httpStatus,
        rawPath,
        errorMessage: message,
      });
    }
    return result;
  }
}

export async function collectFeeds(
  options: CollectOptions,
): Promise<CollectionSummary> {
  const clock = options.clock ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const dryRun = options.dryRun ?? false;
  const sources = selectSources(options.config, options.sourceIds);
  if (sources.length === 0) {
    throw new Error("No enabled sources selected.");
  }

  const runId = randomUUID();
  const startedAt = clock().toISOString();

  if (!dryRun) {
    for (const source of sources) {
      options.repository.upsertSource({
        id: source.id,
        name: source.name,
        url: source.homepage_url,
        tier: source.tier,
        kind: source.kind,
        enabled: source.enabled,
        metadata: {
          feedUrl: source.feed_url,
          format: source.format,
          topics: source.topics,
          notes: source.notes ?? null,
        },
      });
    }
    options.repository.startCollectionRun({
      id: runId,
      startedAt,
      sourceCount: sources.length,
      dryRun,
    });
  }

  const results = await mapConcurrent(
    sources,
    options.config.defaults.concurrency,
    (source) =>
      collectSource(source, {
        config: options.config,
        repository: options.repository,
        dataDirectory: options.dataDirectory,
        dryRun,
        fetchImpl,
        clock,
        runId,
      }),
  );
  const successCount = results.filter(
    (result) => result.status === "success",
  ).length;
  const failureCount = results.filter(
    (result) => result.status === "failed",
  ).length;
  const notModifiedCount = results.filter(
    (result) => result.status === "not_modified",
  ).length;
  const status =
    failureCount === 0
      ? "completed"
      : failureCount === sources.length
        ? "failed"
        : "partial";
  const completedAt = clock().toISOString();
  const summary: CollectionSummary = {
    runId,
    status,
    dryRun,
    startedAt,
    completedAt,
    sourceCount: sources.length,
    successCount,
    failureCount,
    notModifiedCount,
    newDocumentCount: results.reduce(
      (total, result) => total + result.newDocuments,
      0,
    ),
    duplicateDocumentCount: results.reduce(
      (total, result) => total + result.duplicateDocuments,
      0,
    ),
    filteredByAgeCount: results.reduce(
      (total, result) => total + result.filteredByAge,
      0,
    ),
    sources: results,
  };

  if (!dryRun) {
    options.repository.finishCollectionRun({
      id: runId,
      completedAt,
      status,
      successCount,
      failureCount,
      notModifiedCount,
      newDocumentCount: summary.newDocumentCount,
      duplicateDocumentCount: summary.duplicateDocumentCount,
    });
  }

  return summary;
}
