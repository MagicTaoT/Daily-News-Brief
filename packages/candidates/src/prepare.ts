import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  parseCandidateBundle,
  type CandidateBundle,
  type CandidateEvent,
  type SourcesConfig,
} from "@morning-signal/contracts";
import type { AnalysisDocument, NewsRepository } from "@morning-signal/storage";

import { inferSeverity, rankingSignals } from "./classify.js";
import { clusterDocuments, type DocumentCluster } from "./cluster.js";
import type { LoadedProfile } from "./config.js";
import { editionWindow } from "./window.js";

export interface PrepareCandidatesOptions {
  repository: NewsRepository;
  profile: LoadedProfile;
  sources: SourcesConfig;
  editionDate: string;
  dataDirectory: string;
  clock?: () => Date;
}

export interface PreparedCandidates {
  bundle: CandidateBundle;
  filePath: string;
}

function clusterTimes(cluster: DocumentCluster): {
  firstSeenAt: string;
  lastUpdatedAt: string;
} {
  const times = cluster.documents
    .map((document) => document.effectiveAt)
    .sort();
  const firstSeenAt = times[0];
  const lastUpdatedAt = times.at(-1);
  if (!firstSeenAt || !lastUpdatedAt) {
    throw new Error(`Event ${cluster.eventId} has no source documents.`);
  }
  return { firstSeenAt, lastUpdatedAt };
}

function representativeDocument(
  documents: AnalysisDocument[],
): AnalysisDocument {
  const representative = [...documents].sort(
    (left, right) =>
      left.sourceTier - right.sourceTier ||
      right.body.length - left.body.length ||
      right.effectiveAt.localeCompare(left.effectiveAt),
  )[0];
  if (!representative) {
    throw new Error("Cannot select a representative from an empty event.");
  }
  return representative;
}

function candidateFromCluster(
  cluster: DocumentCluster,
  previouslyPublished: boolean,
  profile: LoadedProfile["config"],
): CandidateEvent {
  const representative = representativeDocument(cluster.documents);
  const sourceIds = new Set(
    cluster.documents.map((document) => document.sourceId),
  );
  const tier1SourceIds = new Set(
    cluster.documents
      .filter((document) => document.sourceTier === 1)
      .map((document) => document.sourceId),
  );
  const independentSourceCount = sourceIds.size;
  const verificationStatus =
    tier1SourceIds.size > 0
      ? "confirmed"
      : independentSourceCount >= 2
        ? "multi_source"
        : "unverified";
  const { firstSeenAt, lastUpdatedAt } = clusterTimes(cluster);
  const severity = inferSeverity(
    representative.title,
    representative.body,
    cluster.topic,
  );
  const ranked = rankingSignals(
    cluster.topic,
    representative.title,
    representative.body,
    cluster.documents.map((document) => document.sourceTier),
    independentSourceCount,
    Math.min(
      ...cluster.documents.map((document) =>
        Math.max(document.sourceTopics.length, 1),
      ),
    ),
    previouslyPublished,
    profile,
  );

  return {
    event_id: cluster.eventId,
    topic: cluster.topic,
    headline: representative.title,
    summary_seed: representative.body.slice(0, 1_500),
    verification_status: verificationStatus,
    severity,
    first_seen_at: firstSeenAt,
    last_updated_at: lastUpdatedAt,
    selection_reason: "current_window",
    source_count: sourceIds.size,
    independent_source_count: independentSourceCount,
    tier_1_source_count: tier1SourceIds.size,
    ranking_signals: ranked.signals,
    internal_priority: ranked.priority,
    documents: [...cluster.documents]
      .sort(
        (left, right) =>
          left.sourceTier - right.sourceTier ||
          right.effectiveAt.localeCompare(left.effectiveAt),
      )
      .map((document) => ({
        document_id: document.id,
        source_id: document.sourceId,
        publisher: document.sourceName,
        tier: document.sourceTier,
        title: document.title,
        url: document.url,
        published_at: document.publishedAt,
        retrieved_at: document.retrievedAt,
      })),
  };
}

function persistCluster(
  repository: NewsRepository,
  cluster: DocumentCluster,
  candidate: CandidateEvent,
): void {
  repository.upsertEvent({
    id: candidate.event_id,
    topic: candidate.topic,
    headline: candidate.headline,
    summary: candidate.summary_seed,
    verificationStatus: candidate.verification_status,
    severity: candidate.severity,
    lifecycleStatus: "active",
    firstSeenAt: candidate.first_seen_at,
    lastUpdatedAt: candidate.last_updated_at,
    metadata: {
      clusterAlgorithm: "conservative-title-v1",
      internalPriority: candidate.internal_priority,
      rankingSignals: candidate.ranking_signals,
    },
  });

  for (const document of cluster.documents) {
    repository.linkEventDocument(candidate.event_id, document.id, "supports");
  }

  const newlyLinkedDocuments = cluster.documents.filter(
    (document) => document.existingEventId === null,
  );
  if (!cluster.existing || newlyLinkedDocuments.length > 0) {
    repository.addEventUpdate({
      eventId: candidate.event_id,
      observedAt: candidate.last_updated_at,
      updateType: cluster.existing ? "developed" : "discovered",
      summary: cluster.existing
        ? `${newlyLinkedDocuments.length} new source document(s) linked.`
        : `Event discovered from ${candidate.source_count} source(s).`,
      sourceCount: candidate.source_count,
      payload: {
        documentIds: newlyLinkedDocuments.map((document) => document.id),
      },
    });
  }
}

function writeBundle(dataDirectory: string, bundle: CandidateBundle): string {
  const relativePath = join(
    "runs",
    bundle.edition_date,
    bundle.bundle_id,
    "analysis-input.json",
  );
  const path = join(dataDirectory, relativePath);
  mkdirSync(
    join(dataDirectory, "runs", bundle.edition_date, bundle.bundle_id),
    {
      recursive: true,
    },
  );
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  renameSync(temporaryPath, path);
  return relative(dataDirectory, path);
}

export function prepareCandidates(
  options: PrepareCandidatesOptions,
): PreparedCandidates {
  const clock = options.clock ?? (() => new Date());
  const generatedAt = clock().toISOString();
  const bundleId = `candidates-${options.editionDate}-${randomUUID()}`;
  const window = editionWindow(options.editionDate, options.profile.config);
  const repository = options.repository;

  repository.saveProfileVersion({
    profileId: options.profile.config.profile_id,
    version: options.profile.config.profile_version,
    configYaml: options.profile.raw,
    configHash: options.profile.hash,
  });
  repository.saveRun({
    id: bundleId,
    editionDate: options.editionDate,
    profileId: options.profile.config.profile_id,
    profileVersion: options.profile.config.profile_version,
    status: "analyzing",
    stage: "candidate_preparation",
    startedAt: generatedAt,
  });

  try {
    const documents = repository.listDocumentsForAnalysis(
      window.catchupStart.toISOString(),
      window.end.toISOString(),
    );
    const previouslyPublished = repository.getPreviouslyPublishedEventIds(
      options.editionDate,
    );
    const clusters = clusterDocuments(documents, options.profile.config);
    const current: CandidateEvent[] = [];
    const catchup: CandidateEvent[] = [];
    const suppressed: CandidateBundle["suppressed"] = [];

    for (const cluster of clusters) {
      const wasPublished = previouslyPublished.has(cluster.eventId);
      const candidate = candidateFromCluster(
        cluster,
        wasPublished,
        options.profile.config,
      );
      persistCluster(repository, cluster, candidate);

      if (/^green\b/iu.test(candidate.headline)) {
        suppressed.push({
          event_id: candidate.event_id,
          topic: candidate.topic,
          headline: candidate.headline,
          reason: "low_severity_alert",
        });
      } else if (candidate.ranking_signals.relevance < 0.35) {
        suppressed.push({
          event_id: candidate.event_id,
          topic: candidate.topic,
          headline: candidate.headline,
          reason: "low_relevance",
        });
      } else if (
        candidate.last_updated_at >= window.currentStart.toISOString()
      ) {
        current.push({ ...candidate, selection_reason: "current_window" });
      } else if (wasPublished) {
        suppressed.push({
          event_id: candidate.event_id,
          topic: candidate.topic,
          headline: candidate.headline,
          reason: "previously_published",
        });
      } else if (candidate.first_seen_at >= window.catchupStart.toISOString()) {
        catchup.push({ ...candidate, selection_reason: "previously_missed" });
      } else {
        suppressed.push({
          event_id: candidate.event_id,
          topic: candidate.topic,
          headline: candidate.headline,
          reason: "outside_window",
        });
      }
    }

    const byPriority = (left: CandidateEvent, right: CandidateEvent) =>
      right.internal_priority - left.internal_priority ||
      right.last_updated_at.localeCompare(left.last_updated_at);
    current.sort(byPriority);
    catchup.sort(byPriority);

    const enabledSources = options.sources.sources.filter(
      (source) => source.enabled,
    );
    const sourceIdsWithDocuments = new Set(
      documents.map((document) => document.sourceId),
    );
    const failedSources = enabledSources.filter(
      (source) =>
        (repository.getSourceFetchState(source.id)?.consecutiveFailures ?? 0) >
        0,
    );
    const missingSourceIds = enabledSources
      .map((source) => source.id)
      .filter((sourceId) => !sourceIdsWithDocuments.has(sourceId));
    const notes: string[] = [];
    if (missingSourceIds.length > 0) {
      notes.push(
        `No documents in this window from: ${missingSourceIds.join(", ")}.`,
      );
    }
    if (failedSources.length > 0) {
      notes.push(
        `Sources with unresolved collection failures: ${failedSources
          .map((source) => source.id)
          .join(", ")}.`,
      );
    }

    const bundle = parseCandidateBundle({
      schema_version: "1.0",
      bundle_id: bundleId,
      edition_date: options.editionDate,
      timezone: options.profile.config.timezone,
      profile_id: options.profile.config.profile_id,
      profile_version: options.profile.config.profile_version,
      generated_at: generatedAt,
      window: {
        current_start: window.currentStart.toISOString(),
        end: window.end.toISOString(),
        catchup_start: window.catchupStart.toISOString(),
      },
      coverage_health: {
        configured_sources: enabledSources.length,
        sources_with_documents: sourceIdsWithDocuments.size,
        sources_failed: failedSources.length,
        failed_source_ids: failedSources.map((source) => source.id),
        notes,
      },
      current_24h: current,
      catch_up_7d: catchup,
      suppressed,
      stats: {
        documents_considered: documents.length,
        event_clusters: clusters.length,
        current_candidates: current.length,
        catchup_candidates: catchup.length,
        suppressed_candidates: suppressed.length,
      },
    });
    const filePath = writeBundle(options.dataDirectory, bundle);
    repository.saveAnalysisBundle(bundle, filePath);
    repository.saveRun({
      id: bundleId,
      editionDate: options.editionDate,
      profileId: options.profile.config.profile_id,
      profileVersion: options.profile.config.profile_version,
      status: "completed",
      stage: "candidate_preparation",
      startedAt: generatedAt,
      completedAt: clock().toISOString(),
      metrics: bundle.stats,
    });
    return { bundle, filePath };
  } catch (error) {
    repository.saveRun({
      id: bundleId,
      editionDate: options.editionDate,
      profileId: options.profile.config.profile_id,
      profileVersion: options.profile.config.profile_version,
      status: "failed",
      stage: "candidate_preparation",
      startedAt: generatedAt,
      completedAt: clock().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
