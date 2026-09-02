import { createHash } from "node:crypto";

import type { ProfileConfig, Topic } from "@morning-signal/contracts";
import type { AnalysisDocument } from "@morning-signal/storage";

import {
  classifyTopic,
  normalizeTitle,
  sharedTitleTokenCount,
  titleSimilarity,
} from "./classify.js";

const MAX_CLUSTER_DISTANCE_MS = 72 * 3_600_000;

export interface DocumentCluster {
  eventId: string;
  existing: boolean;
  topic: Topic;
  documents: AnalysisDocument[];
}

interface MutableCluster {
  existingEventId: string | null;
  topic: Topic;
  documents: AnalysisDocument[];
}

function withinClusterDistance(
  document: AnalysisDocument,
  cluster: MutableCluster,
): boolean {
  const timestamp = Date.parse(document.effectiveAt);
  return cluster.documents.some(
    (candidate) =>
      Math.abs(timestamp - Date.parse(candidate.effectiveAt)) <=
      MAX_CLUSTER_DISTANCE_MS,
  );
}

function matchScore(
  document: AnalysisDocument,
  topic: Topic,
  cluster: MutableCluster,
): number {
  if (!withinClusterDistance(document, cluster)) {
    return -1;
  }

  const exact = cluster.documents.some(
    (candidate) =>
      normalizeTitle(candidate.title) === normalizeTitle(document.title),
  );
  if (exact) {
    return 1;
  }
  if (cluster.topic !== topic) {
    return -1;
  }

  const crossSourceCandidates = cluster.documents.filter(
    (candidate) => candidate.sourceId !== document.sourceId,
  );
  return crossSourceCandidates.reduce((best, candidate) => {
    const shared = sharedTitleTokenCount(candidate.title, document.title);
    const similarity = titleSimilarity(candidate.title, document.title);
    return shared >= 3 && similarity >= 0.68
      ? Math.max(best, similarity)
      : best;
  }, -1);
}

function generatedEventId(document: AnalysisDocument): string {
  const digest = createHash("sha256")
    .update(document.id)
    .digest("hex")
    .slice(0, 24);
  return `event-${digest}`;
}

export function clusterDocuments(
  documents: AnalysisDocument[],
  profile: ProfileConfig,
): DocumentCluster[] {
  const clusters: MutableCluster[] = [];
  const existingClusters = new Map<string, MutableCluster>();

  for (const document of documents) {
    if (!document.existingEventId) {
      continue;
    }
    let cluster = existingClusters.get(document.existingEventId);
    if (!cluster) {
      cluster = {
        existingEventId: document.existingEventId,
        topic: classifyTopic(document, profile),
        documents: [],
      };
      existingClusters.set(document.existingEventId, cluster);
      clusters.push(cluster);
    }
    cluster.documents.push(document);
  }

  for (const document of documents) {
    if (document.existingEventId) {
      continue;
    }
    const topic = classifyTopic(document, profile);
    let bestCluster: MutableCluster | null = null;
    let bestScore = -1;

    for (const cluster of clusters) {
      const score = matchScore(document, topic, cluster);
      if (score > bestScore) {
        bestCluster = cluster;
        bestScore = score;
      }
    }

    if (bestCluster && bestScore >= 0) {
      bestCluster.documents.push(document);
    } else {
      clusters.push({ existingEventId: null, topic, documents: [document] });
    }
  }

  return clusters.map((cluster) => {
    const sortedDocuments = [...cluster.documents].sort(
      (left, right) =>
        left.effectiveAt.localeCompare(right.effectiveAt) ||
        left.id.localeCompare(right.id),
    );
    const anchor = sortedDocuments[0];
    if (!anchor) {
      throw new Error("Cannot create an event from an empty cluster.");
    }
    return {
      eventId: cluster.existingEventId ?? generatedEventId(anchor),
      existing: cluster.existingEventId !== null,
      topic: cluster.topic,
      documents: sortedDocuments,
    };
  });
}
