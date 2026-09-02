import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  TOPIC_IDS,
  parseCandidateBundle,
  parseEdition,
  type CandidateBundle,
  type Citation,
  type Edition,
  type EditionStatus,
  type Topic,
} from "@morning-signal/contracts";

export type SourceKind = "rss" | "website" | "api" | "social" | "manual";
export type SourceTier = 1 | 2 | 3 | 4;
export type EventRelationship = "supports" | "contradicts" | "context";
export type EventLifecycleStatus = "active" | "resolved" | "disputed";
export type EventUpdateType =
  "discovered" | "confirmed" | "developed" | "corrected" | "resolved";

export interface SourceInput {
  id: string;
  name: string;
  url: string;
  tier: SourceTier;
  kind: SourceKind;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DocumentInput {
  id: string;
  sourceId: string;
  url: string;
  canonicalUrl?: string | null;
  title: string;
  author?: string | null;
  publishedAt?: string | null;
  retrievedAt: string;
  language?: string | null;
  body: string;
  contentHash: string;
  rawPath?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EventInput {
  id: string;
  topic: Topic;
  headline: string;
  summary: string;
  verificationStatus:
    "unverified" | "multi_source" | "confirmed" | "disputed" | "resolved";
  severity?: "critical" | "high" | "watch" | null;
  lifecycleStatus?: EventLifecycleStatus;
  firstSeenAt: string;
  lastUpdatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface EventUpdateInput {
  id?: string;
  eventId: string;
  observedAt: string;
  updateType: EventUpdateType;
  summary: string;
  sourceCount?: number;
  payload?: Record<string, unknown>;
}

export interface ProfileVersionInput {
  profileId: string;
  version: number;
  configYaml: string;
  configHash: string;
}

export interface RunInput {
  id: string;
  editionDate: string;
  profileId: string;
  profileVersion: number;
  status:
    | "queued"
    | "collecting"
    | "analyzing"
    | "review_required"
    | "completed"
    | "failed";
  stage: string;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  metrics?: Record<string, unknown>;
}

export interface EditionSummary {
  editionId: string;
  editionDate: string;
  profileVersion: number;
  status: EditionStatus;
  generatedAt: string;
  publishedAt: string | null;
  revisionNumber: number;
}

export interface EventSearchResult {
  id: string;
  topic: Topic;
  headline: string;
  summary: string;
  verificationStatus: EventInput["verificationStatus"];
  severity: EventInput["severity"];
  firstSeenAt: string;
  lastUpdatedAt: string;
  relevance: number;
}

export interface StorageStats {
  sources: number;
  documents: number;
  events: number;
  editions: number;
  feedback: number;
  collectionRuns: number;
  analysisBundles: number;
  latestEditionDate: string | null;
}

export interface AnalysisDocument {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceTier: SourceTier;
  url: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  effectiveAt: string;
  language: string | null;
  body: string;
  sourceTopics: Topic[];
  existingEventId: string | null;
}

export interface SourceFetchState {
  sourceId: string;
  etag: string | null;
  lastModified: string | null;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface CollectionRunInput {
  id: string;
  startedAt: string;
  sourceCount: number;
  dryRun: boolean;
}

export interface CollectionRunResult {
  id: string;
  completedAt: string;
  status: "completed" | "partial" | "failed";
  successCount: number;
  failureCount: number;
  notModifiedCount: number;
  newDocumentCount: number;
  duplicateDocumentCount: number;
}

export interface CollectionAttemptInput {
  id?: string;
  collectionRunId: string;
  sourceId: string;
  status: "success" | "not_modified" | "failed";
  startedAt: string;
  completedAt: string;
  httpStatus?: number | null;
  rawPath?: string | null;
  itemsSeen?: number;
  newDocumentCount?: number;
  duplicateDocumentCount?: number;
  errorMessage?: string | null;
}

interface NormalizedEditionItem {
  id: string;
  eventId: string | null;
  section:
    | "risk_alerts"
    | "must_read"
    | "catch_up"
    | "market_macro_pulse"
    | "next_7_days"
    | "weak_signals";
  rank: number;
  topic: string | null;
  headline: string;
  summary: string;
  payload: unknown;
  citations: Citation[];
}

function now(): string {
  return new Date().toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function normalizeEditionItems(edition: Edition): NormalizedEditionItem[] {
  const items: NormalizedEditionItem[] = [];

  for (const [rank, story] of edition.risk_alerts.entries()) {
    items.push({
      id: story.id,
      eventId: story.event_id,
      section: "risk_alerts",
      rank,
      topic: story.topic,
      headline: story.headline,
      summary: story.what_happened,
      payload: story,
      citations: story.citations,
    });
  }

  for (const [rank, story] of edition.must_read.entries()) {
    items.push({
      id: story.id,
      eventId: story.event_id,
      section: "must_read",
      rank,
      topic: story.topic,
      headline: story.headline,
      summary: story.what_happened,
      payload: story,
      citations: story.citations,
    });
  }

  for (const [rank, story] of edition.catch_up.entries()) {
    items.push({
      id: story.id,
      eventId: story.event_id,
      section: "catch_up",
      rank,
      topic: story.topic,
      headline: story.headline,
      summary: story.what_happened,
      payload: story,
      citations: story.citations,
    });
  }

  for (const [rank, pulse] of edition.market_macro_pulse.entries()) {
    items.push({
      id: `market-macro-pulse-${rank}`,
      eventId: null,
      section: "market_macro_pulse",
      rank,
      topic: "macro",
      headline: pulse.name,
      summary: pulse.explanation,
      payload: pulse,
      citations: pulse.citations,
    });
  }

  for (const [rank, calendarItem] of edition.next_7_days.entries()) {
    items.push({
      id: `next-7-days-${rank}`,
      eventId: null,
      section: "next_7_days",
      rank,
      topic: calendarItem.topic,
      headline: calendarItem.title,
      summary: calendarItem.why_watch,
      payload: calendarItem,
      citations: calendarItem.citations,
    });
  }

  for (const [rank, signal] of edition.weak_signals.entries()) {
    items.push({
      id: `weak-signal-${rank}`,
      eventId: null,
      section: "weak_signals",
      rank,
      topic: null,
      headline: signal.title,
      summary: signal.evidence,
      payload: signal,
      citations: signal.citations,
    });
  }

  return items;
}

function toFtsQuery(query: string): string | null {
  const terms = query
    .trim()
    .split(/\s+/u)
    .map((term) => term.replaceAll('"', "").trim())
    .filter(Boolean);

  return terms.length === 0
    ? null
    : terms.map((term) => `"${term}"*`).join(" AND ");
}

function clampLimit(limit: number, maximum: number): number {
  if (!Number.isFinite(limit)) {
    return Math.min(20, maximum);
  }

  return Math.max(1, Math.min(Math.trunc(limit), maximum));
}

function metadataTopics(...metadataValues: string[]): Topic[] {
  const allowed = new Set<string>(TOPIC_IDS);

  for (const metadataValue of metadataValues) {
    try {
      const parsed = JSON.parse(metadataValue) as Record<string, unknown>;
      const topics = parsed.sourceTopics ?? parsed.topics;
      if (Array.isArray(topics)) {
        return topics.filter(
          (topic): topic is Topic =>
            typeof topic === "string" && allowed.has(topic),
        );
      }
    } catch {
      // Invalid metadata is treated as absent; core columns remain readable.
    }
  }

  return [];
}

export class NewsRepository {
  constructor(private readonly database: DatabaseSync) {}

  upsertSource(input: SourceInput): void {
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO sources(
          id, name, url, tier, kind, enabled, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          url = excluded.url,
          tier = excluded.tier,
          kind = excluded.kind,
          enabled = excluded.enabled,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.name,
        input.url,
        input.tier,
        input.kind,
        input.enabled === false ? 0 : 1,
        json(input.metadata),
        timestamp,
        timestamp,
      );
  }

  saveDocument(input: DocumentInput): { id: string; inserted: boolean } {
    const existing = this.database
      .prepare(
        "SELECT id FROM documents WHERE url = ? OR content_hash = ? LIMIT 1",
      )
      .get(input.url, input.contentHash) as { id: string } | undefined;

    if (existing) {
      return { id: existing.id, inserted: false };
    }

    this.database
      .prepare(
        `INSERT INTO documents(
          id, source_id, url, canonical_url, title, author, published_at,
          retrieved_at, language, body, content_hash, raw_path, metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sourceId,
        input.url,
        input.canonicalUrl ?? null,
        input.title,
        input.author ?? null,
        input.publishedAt ?? null,
        input.retrievedAt,
        input.language ?? null,
        input.body,
        input.contentHash,
        input.rawPath ?? null,
        json(input.metadata),
        now(),
      );

    return { id: input.id, inserted: true };
  }

  listDocumentsForAnalysis(
    start: string,
    end: string,
    limit = 5_000,
  ): AnalysisDocument[] {
    const rows = this.database
      .prepare(
        `SELECT
          documents.id,
          documents.source_id,
          sources.name AS source_name,
          sources.tier AS source_tier,
          documents.url,
          documents.canonical_url,
          documents.title,
          documents.author,
          documents.published_at,
          documents.retrieved_at,
          COALESCE(documents.published_at, documents.retrieved_at) AS effective_at,
          documents.language,
          documents.body,
          documents.metadata_json AS document_metadata_json,
          sources.metadata_json AS source_metadata_json,
          MIN(event_documents.event_id) AS existing_event_id
         FROM documents
         JOIN sources ON sources.id = documents.source_id
         LEFT JOIN event_documents ON event_documents.document_id = documents.id
         WHERE COALESCE(documents.published_at, documents.retrieved_at) >= ?
           AND COALESCE(documents.published_at, documents.retrieved_at) < ?
         GROUP BY documents.id
         ORDER BY effective_at, documents.id
         LIMIT ?`,
      )
      .all(start, end, clampLimit(limit, 20_000)) as unknown as Array<{
      id: string;
      source_id: string;
      source_name: string;
      source_tier: SourceTier;
      url: string;
      canonical_url: string | null;
      title: string;
      author: string | null;
      published_at: string | null;
      retrieved_at: string;
      effective_at: string;
      language: string | null;
      body: string;
      document_metadata_json: string;
      source_metadata_json: string;
      existing_event_id: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceTier: row.source_tier,
      url: row.url,
      canonicalUrl: row.canonical_url,
      title: row.title,
      author: row.author,
      publishedAt: row.published_at,
      retrievedAt: row.retrieved_at,
      effectiveAt: row.effective_at,
      language: row.language,
      body: row.body,
      sourceTopics: metadataTopics(
        row.document_metadata_json,
        row.source_metadata_json,
      ),
      existingEventId: row.existing_event_id,
    }));
  }

  getPreviouslyPublishedEventIds(beforeEditionDate: string): Set<string> {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT edition_items.event_id
         FROM edition_items
         JOIN editions ON editions.edition_id = edition_items.edition_id
         WHERE editions.edition_date < ?
           AND editions.status IN ('published', 'revised')
           AND edition_items.event_id IS NOT NULL`,
      )
      .all(beforeEditionDate) as unknown as Array<{ event_id: string }>;
    return new Set(rows.map((row) => row.event_id));
  }

  saveAnalysisBundle(value: unknown, filePath: string): CandidateBundle {
    const bundle = parseCandidateBundle(value);
    this.database
      .prepare(
        `INSERT INTO analysis_bundles(
          bundle_id, edition_date, profile_id, profile_version, generated_at,
          current_start, window_end, catchup_start, file_path, payload_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bundle.bundle_id,
        bundle.edition_date,
        bundle.profile_id,
        bundle.profile_version,
        bundle.generated_at,
        bundle.window.current_start,
        bundle.window.end,
        bundle.window.catchup_start,
        filePath,
        json(bundle),
        now(),
      );
    return bundle;
  }

  startCollectionRun(input: CollectionRunInput): void {
    this.database
      .prepare(
        `INSERT INTO collection_runs(
          id, started_at, status, source_count, dry_run
        ) VALUES (?, ?, 'running', ?, ?)`,
      )
      .run(input.id, input.startedAt, input.sourceCount, input.dryRun ? 1 : 0);
  }

  finishCollectionRun(input: CollectionRunResult): void {
    this.database
      .prepare(
        `UPDATE collection_runs SET
          completed_at = ?, status = ?, success_count = ?, failure_count = ?,
          not_modified_count = ?, new_document_count = ?,
          duplicate_document_count = ?
         WHERE id = ?`,
      )
      .run(
        input.completedAt,
        input.status,
        input.successCount,
        input.failureCount,
        input.notModifiedCount,
        input.newDocumentCount,
        input.duplicateDocumentCount,
        input.id,
      );
  }

  recordCollectionAttempt(input: CollectionAttemptInput): string {
    const id = input.id ?? randomUUID();
    this.database
      .prepare(
        `INSERT INTO collection_attempts(
          id, collection_run_id, source_id, status, started_at, completed_at,
          http_status, raw_path, items_seen, new_document_count,
          duplicate_document_count, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.collectionRunId,
        input.sourceId,
        input.status,
        input.startedAt,
        input.completedAt,
        input.httpStatus ?? null,
        input.rawPath ?? null,
        input.itemsSeen ?? 0,
        input.newDocumentCount ?? 0,
        input.duplicateDocumentCount ?? 0,
        input.errorMessage ?? null,
      );
    return id;
  }

  getSourceFetchState(sourceId: string): SourceFetchState | null {
    const row = this.database
      .prepare(
        `SELECT
          source_id, etag, last_modified, last_attempt_at, last_success_at,
          consecutive_failures, last_error
         FROM source_fetch_state WHERE source_id = ?`,
      )
      .get(sourceId) as
      | {
          source_id: string;
          etag: string | null;
          last_modified: string | null;
          last_attempt_at: string;
          last_success_at: string | null;
          consecutive_failures: number;
          last_error: string | null;
        }
      | undefined;

    return row
      ? {
          sourceId: row.source_id,
          etag: row.etag,
          lastModified: row.last_modified,
          lastAttemptAt: row.last_attempt_at,
          lastSuccessAt: row.last_success_at,
          consecutiveFailures: row.consecutive_failures,
          lastError: row.last_error,
        }
      : null;
  }

  markSourceFetchSuccess(input: {
    sourceId: string;
    attemptedAt: string;
    etag?: string | null;
    lastModified?: string | null;
  }): void {
    this.database
      .prepare(
        `INSERT INTO source_fetch_state(
          source_id, etag, last_modified, last_attempt_at, last_success_at,
          consecutive_failures, last_error, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          etag = COALESCE(excluded.etag, source_fetch_state.etag),
          last_modified = COALESCE(excluded.last_modified, source_fetch_state.last_modified),
          last_attempt_at = excluded.last_attempt_at,
          last_success_at = excluded.last_success_at,
          consecutive_failures = 0,
          last_error = NULL,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.sourceId,
        input.etag ?? null,
        input.lastModified ?? null,
        input.attemptedAt,
        input.attemptedAt,
        now(),
      );
  }

  markSourceFetchFailure(input: {
    sourceId: string;
    attemptedAt: string;
    error: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO source_fetch_state(
          source_id, last_attempt_at, consecutive_failures, last_error, updated_at
        ) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          last_attempt_at = excluded.last_attempt_at,
          consecutive_failures = source_fetch_state.consecutive_failures + 1,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`,
      )
      .run(input.sourceId, input.attemptedAt, input.error, now());
  }

  upsertEvent(input: EventInput): void {
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO events(
          id, topic, headline, summary, verification_status, severity,
          lifecycle_status, first_seen_at, last_updated_at, metadata_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          topic = excluded.topic,
          headline = excluded.headline,
          summary = excluded.summary,
          verification_status = excluded.verification_status,
          severity = excluded.severity,
          lifecycle_status = excluded.lifecycle_status,
          first_seen_at = MIN(events.first_seen_at, excluded.first_seen_at),
          last_updated_at = MAX(events.last_updated_at, excluded.last_updated_at),
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.topic,
        input.headline,
        input.summary,
        input.verificationStatus,
        input.severity ?? null,
        input.lifecycleStatus ?? "active",
        input.firstSeenAt,
        input.lastUpdatedAt,
        json(input.metadata),
        timestamp,
        timestamp,
      );
  }

  linkEventDocument(
    eventId: string,
    documentId: string,
    relationship: EventRelationship = "supports",
  ): void {
    this.database
      .prepare(
        `INSERT INTO event_documents(event_id, document_id, relationship, linked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id, document_id) DO UPDATE SET
           relationship = excluded.relationship`,
      )
      .run(eventId, documentId, relationship, now());
  }

  addEventUpdate(input: EventUpdateInput): string {
    const id = input.id ?? randomUUID();
    this.database
      .prepare(
        `INSERT INTO event_updates(
          id, event_id, observed_at, update_type, summary, source_count,
          payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.eventId,
        input.observedAt,
        input.updateType,
        input.summary,
        input.sourceCount ?? 0,
        json(input.payload),
        now(),
      );
    return id;
  }

  saveProfileVersion(input: ProfileVersionInput): void {
    this.database
      .prepare(
        `INSERT INTO profile_versions(
          profile_id, version, config_yaml, config_hash, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, version) DO UPDATE SET
          config_yaml = excluded.config_yaml,
          config_hash = excluded.config_hash`,
      )
      .run(
        input.profileId,
        input.version,
        input.configYaml,
        input.configHash,
        now(),
      );
  }

  saveRun(input: RunInput): void {
    this.database
      .prepare(
        `INSERT INTO runs(
          id, edition_date, profile_id, profile_version, status, stage,
          started_at, completed_at, error_message, metrics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          stage = excluded.stage,
          completed_at = excluded.completed_at,
          error_message = excluded.error_message,
          metrics_json = excluded.metrics_json`,
      )
      .run(
        input.id,
        input.editionDate,
        input.profileId,
        input.profileVersion,
        input.status,
        input.stage,
        input.startedAt,
        input.completedAt ?? null,
        input.errorMessage ?? null,
        json(input.metrics),
      );
  }

  saveEdition(
    value: unknown,
    options: { supersedesEditionId?: string; createOnly?: boolean } = {},
  ): Edition {
    const edition = parseEdition(value);
    const revisionNumber = edition.revision?.number ?? 1;
    const existing = this.database
      .prepare("SELECT status FROM editions WHERE edition_id = ?")
      .get(edition.edition_id) as { status: EditionStatus } | undefined;

    if (existing && options.createOnly) {
      throw new Error(
        `Edition ${edition.edition_id} already exists; refusing to overwrite an existing draft.`,
      );
    }

    if (existing?.status === "published" || existing?.status === "revised") {
      throw new Error(
        `Edition ${edition.edition_id} is immutable; create a new revision instead.`,
      );
    }

    let supersedesEditionId = options.supersedesEditionId ?? null;
    if (edition.status === "revised" && supersedesEditionId === null) {
      const prior = this.database
        .prepare(
          `SELECT edition_id FROM editions
           WHERE edition_date = ? AND profile_version = ? AND revision_number < ?
             AND status IN ('published', 'revised')
           ORDER BY revision_number DESC LIMIT 1`,
        )
        .get(edition.edition_date, edition.profile_version, revisionNumber) as
        { edition_id: string } | undefined;
      supersedesEditionId = prior?.edition_id ?? null;
    }

    if (edition.status === "revised" && supersedesEditionId === null) {
      throw new Error("A revised edition must supersede a published edition.");
    }

    const timestamp = now();
    const items = normalizeEditionItems(edition);
    this.database.exec("BEGIN IMMEDIATE;");

    try {
      if (existing) {
        this.database
          .prepare("DELETE FROM edition_items WHERE edition_id = ?")
          .run(edition.edition_id);
        this.database
          .prepare(
            `UPDATE editions SET
              edition_date = ?, profile_version = ?, status = ?, generated_at = ?,
              published_at = ?, run_id = ?, revision_number = ?,
              supersedes_edition_id = ?, payload_json = ?, updated_at = ?
             WHERE edition_id = ?`,
          )
          .run(
            edition.edition_date,
            edition.profile_version,
            edition.status,
            edition.generated_at,
            edition.published_at,
            edition.run_id,
            revisionNumber,
            supersedesEditionId,
            json(edition),
            timestamp,
            edition.edition_id,
          );
      } else {
        this.database
          .prepare(
            `INSERT INTO editions(
              edition_id, edition_date, profile_version, status, generated_at,
              published_at, run_id, revision_number, supersedes_edition_id,
              payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            edition.edition_id,
            edition.edition_date,
            edition.profile_version,
            edition.status,
            edition.generated_at,
            edition.published_at,
            edition.run_id,
            revisionNumber,
            supersedesEditionId,
            json(edition),
            timestamp,
            timestamp,
          );
      }

      const insertItem = this.database.prepare(
        `INSERT INTO edition_items(
          edition_id, item_id, event_id, section, rank, topic, headline,
          summary, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertCitation = this.database.prepare(
        `INSERT INTO citations(
          edition_id, item_id, citation_index, source_id, document_id,
          title, url, publisher, published_at, retrieved_at, tier
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      );

      for (const item of items) {
        insertItem.run(
          edition.edition_id,
          item.id,
          item.eventId,
          item.section,
          item.rank,
          item.topic,
          item.headline,
          item.summary,
          json(item.payload),
        );

        for (const [citationIndex, citation] of item.citations.entries()) {
          insertCitation.run(
            edition.edition_id,
            item.id,
            citationIndex,
            citation.source_id,
            citation.title,
            citation.url,
            citation.publisher,
            citation.published_at,
            citation.retrieved_at,
            citation.tier,
          );
        }
      }

      this.database.exec("COMMIT;");
      return edition;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  getEditionByDate(
    editionDate: string,
    profileVersion?: number,
  ): Edition | null {
    const row = (
      profileVersion === undefined
        ? this.database
            .prepare(
              `SELECT payload_json FROM editions
               WHERE edition_date = ?
               ORDER BY revision_number DESC, updated_at DESC LIMIT 1`,
            )
            .get(editionDate)
        : this.database
            .prepare(
              `SELECT payload_json FROM editions
               WHERE edition_date = ? AND profile_version = ?
               ORDER BY revision_number DESC, updated_at DESC LIMIT 1`,
            )
            .get(editionDate, profileVersion)
    ) as { payload_json: string } | undefined;

    return row ? parseEdition(JSON.parse(row.payload_json)) : null;
  }

  listEditions(limit = 30): EditionSummary[] {
    const rows = this.database
      .prepare(
        `SELECT
          edition_id, edition_date, profile_version, status, generated_at,
          published_at, revision_number
         FROM editions
         ORDER BY edition_date DESC, revision_number DESC
         LIMIT ?`,
      )
      .all(clampLimit(limit, 365)) as unknown as Array<{
      edition_id: string;
      edition_date: string;
      profile_version: number;
      status: EditionStatus;
      generated_at: string;
      published_at: string | null;
      revision_number: number;
    }>;

    return rows.map((row) => ({
      editionId: row.edition_id,
      editionDate: row.edition_date,
      profileVersion: row.profile_version,
      status: row.status,
      generatedAt: row.generated_at,
      publishedAt: row.published_at,
      revisionNumber: row.revision_number,
    }));
  }

  searchEvents(query: string, limit = 20): EventSearchResult[] {
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery === null) {
      return [];
    }

    const rows = this.database
      .prepare(
        `SELECT
          events.id,
          events.topic,
          events.headline,
          events.summary,
          events.verification_status,
          events.severity,
          events.first_seen_at,
          events.last_updated_at,
          bm25(events_fts) AS relevance
         FROM events_fts
         JOIN events ON events.rowid = events_fts.rowid
         WHERE events_fts MATCH ?
         ORDER BY relevance, events.last_updated_at DESC
         LIMIT ?`,
      )
      .all(ftsQuery, clampLimit(limit, 100)) as unknown as Array<{
      id: string;
      topic: Topic;
      headline: string;
      summary: string;
      verification_status: EventInput["verificationStatus"];
      severity: EventInput["severity"];
      first_seen_at: string;
      last_updated_at: string;
      relevance: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      headline: row.headline,
      summary: row.summary,
      verificationStatus: row.verification_status,
      severity: row.severity,
      firstSeenAt: row.first_seen_at,
      lastUpdatedAt: row.last_updated_at,
      relevance: row.relevance,
    }));
  }

  addFeedback(input: {
    id?: string;
    editionId: string;
    itemId?: string | null;
    action:
      "useful" | "not_useful" | "promote" | "demote" | "correction" | "note";
    note?: string | null;
  }): string {
    const id = input.id ?? randomUUID();
    this.database
      .prepare(
        `INSERT INTO feedback(
          id, edition_id, item_id, action, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.editionId,
        input.itemId ?? null,
        input.action,
        input.note ?? null,
        now(),
      );
    return id;
  }

  getStats(): StorageStats {
    const count = (table: string): number => {
      const allowedTables = new Set([
        "sources",
        "documents",
        "events",
        "editions",
        "feedback",
        "collection_runs",
        "analysis_bundles",
      ]);
      if (!allowedTables.has(table)) {
        throw new Error(`Unsupported count table: ${table}`);
      }
      const row = this.database
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };
      return Number(row.count);
    };

    const latest = this.database
      .prepare("SELECT MAX(edition_date) AS date FROM editions")
      .get() as { date: string | null };

    return {
      sources: count("sources"),
      documents: count("documents"),
      events: count("events"),
      editions: count("editions"),
      feedback: count("feedback"),
      collectionRuns: count("collection_runs"),
      analysisBundles: count("analysis_bundles"),
      latestEditionDate: latest.date,
    };
  }
}
