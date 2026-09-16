import { readFileSync } from "node:fs";

import {
  parseCandidateBundle,
  parseEdition,
  type CandidateBundle,
  type CandidateEvent,
  type Edition,
  type Story,
} from "@morning-signal/contracts";

export interface ValidatedReviewDraft {
  edition: Edition;
  bundle: CandidateBundle;
}

export function createPublishedRevision(
  validated: ValidatedReviewDraft,
  previous: Edition,
  reason: string,
  revisedAt = new Date().toISOString(),
): Edition {
  if (previous.status !== "published" && previous.status !== "revised") {
    throw new Error(
      "A revision must supersede a published or revised edition.",
    );
  }
  assertEqual(
    validated.edition.edition_date,
    previous.edition_date,
    "revision edition_date",
  );
  assertEqual(
    validated.edition.profile_version,
    previous.profile_version,
    "revision profile_version",
  );
  if (!reason.trim()) {
    throw new Error("A visible revision reason is required.");
  }

  const revisionNumber = (previous.revision?.number ?? 1) + 1;
  return parseEdition({
    ...validated.edition,
    edition_id: `${validated.edition.edition_date}-${validated.bundle.profile_id}-v${revisionNumber}`,
    status: "revised",
    published_at: revisedAt,
    revision: {
      number: revisionNumber,
      revised_at: revisedAt,
      reason: reason.trim(),
    },
  });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label} must match the candidate bundle (expected ${String(expected)}, received ${String(actual)}).`,
    );
  }
}

function assertCandidateStory(
  story: Story,
  candidate: CandidateEvent | undefined,
  section: "risk_alerts" | "must_read" | "catch_up",
): CandidateEvent {
  if (!candidate) {
    throw new Error(
      `${section} item ${story.id} references event ${story.event_id}, which is not eligible for that section.`,
    );
  }

  assertEqual(story.topic, candidate.topic, `${section}.${story.id}.topic`);
  assertEqual(
    story.first_seen_at,
    candidate.first_seen_at,
    `${section}.${story.id}.first_seen_at`,
  );
  assertEqual(
    story.last_updated_at,
    candidate.last_updated_at,
    `${section}.${story.id}.last_updated_at`,
  );

  if (story.verification_status !== candidate.verification_status) {
    throw new Error(
      `${section}.${story.id}.verification_status must remain ${candidate.verification_status}; evidence changes require a new provenance workflow.`,
    );
  }

  const hasCandidateCitation = story.citations.some((citation) =>
    candidate.documents.some(
      (document) =>
        citation.source_id === document.source_id &&
        citation.title === document.title &&
        citation.url === document.url &&
        citation.publisher === document.publisher &&
        citation.published_at === document.published_at &&
        citation.retrieved_at === document.retrieved_at &&
        citation.tier === document.tier,
    ),
  );
  if (!hasCandidateCitation) {
    throw new Error(
      `${section}.${story.id} must cite at least one document from candidate ${candidate.event_id}.`,
    );
  }

  return candidate;
}

const PROTOCOL_PATTERNS = [
  ["aave", /\baave\b/iu],
  ["uniswap", /\buniswap\b/iu],
  ["morpho", /\bmorpho\b/iu],
  ["maker-sky", /\b(?:makerdao|maker protocol|sky protocol)\b/iu],
  ["compound", /\bcompound(?: finance)?\b/iu],
  ["lido", /\blido\b/iu],
  ["eigenlayer", /\beigenlayer\b/iu],
  ["curve", /\bcurve(?: finance| dao)?\b/iu],
  ["pendle", /\bpendle\b/iu],
  ["chainlink", /\bchainlink\b/iu],
] as const;

function candidateProtocol(candidate: CandidateEvent): string | null {
  const evidence = `${candidate.headline} ${candidate.documents
    .map((document) => `${document.source_id} ${document.publisher}`)
    .join(" ")}`;
  return (
    PROTOCOL_PATTERNS.find(([, pattern]) => pattern.test(evidence))?.[0] ?? null
  );
}

export function validateReviewDraft(
  editionValue: unknown,
  bundleValue: unknown,
): ValidatedReviewDraft {
  const edition = parseEdition(editionValue);
  const bundle = parseCandidateBundle(bundleValue);

  assertEqual(edition.status, "review_required", "status");
  assertEqual(edition.published_at, null, "published_at");
  assertEqual(edition.revision ?? null, null, "revision");
  assertEqual(edition.edition_date, bundle.edition_date, "edition_date");
  assertEqual(edition.timezone, bundle.timezone, "timezone");
  assertEqual(
    edition.profile_version,
    bundle.profile_version,
    "profile_version",
  );
  assertEqual(edition.run_id, bundle.bundle_id, "run_id");
  assertEqual(
    edition.edition_id,
    `${bundle.edition_date}-${bundle.profile_id}-v1`,
    "edition_id",
  );
  assertEqual(
    edition.coverage.start,
    bundle.window.current_start,
    "coverage.start",
  );
  assertEqual(edition.coverage.end, bundle.window.end, "coverage.end");
  assertEqual(
    edition.coverage.catchup_start,
    bundle.window.catchup_start,
    "coverage.catchup_start",
  );
  assertEqual(
    edition.coverage_health.sources_checked,
    bundle.coverage_health.configured_sources,
    "coverage_health.sources_checked",
  );
  assertEqual(
    edition.coverage_health.sources_failed,
    bundle.coverage_health.sources_failed,
    "coverage_health.sources_failed",
  );

  if (
    edition.coverage_health.status === "complete" &&
    bundle.coverage_health.sources_failed > 0
  ) {
    throw new Error(
      "coverage_health.status cannot be complete when configured sources failed.",
    );
  }

  const currentCandidates = new Map(
    bundle.current_24h.map((candidate) => [candidate.event_id, candidate]),
  );
  const catchupCandidates = new Map(
    bundle.catch_up_7d.map((candidate) => [candidate.event_id, candidate]),
  );
  const itemIds = new Set<string>();
  const eventIds = new Set<string>();
  const mustReadProtocols = new Set<string>();

  const registerStory = (story: Story): void => {
    if (itemIds.has(story.id)) {
      throw new Error(`Duplicate edition item id: ${story.id}.`);
    }
    if (eventIds.has(story.event_id)) {
      throw new Error(`Event ${story.event_id} is selected more than once.`);
    }
    itemIds.add(story.id);
    eventIds.add(story.event_id);
  };

  for (const alert of edition.risk_alerts) {
    registerStory(alert);
    const candidate = assertCandidateStory(
      alert,
      currentCandidates.get(alert.event_id),
      "risk_alerts",
    );
    if (candidate.severity === null || alert.severity !== candidate.severity) {
      throw new Error(
        `risk_alerts.${alert.id}.severity must match a non-null candidate severity.`,
      );
    }
  }

  for (const story of edition.must_read) {
    registerStory(story);
    const candidate = assertCandidateStory(
      story,
      currentCandidates.get(story.event_id),
      "must_read",
    );
    const protocol = candidateProtocol(candidate);
    if (protocol && mustReadProtocols.has(protocol)) {
      throw new Error(
        `must_read contains more than one core item for protocol ${protocol}; merge related updates or keep only the most important one.`,
      );
    }
    if (protocol) {
      mustReadProtocols.add(protocol);
    }
  }

  for (const story of edition.catch_up) {
    registerStory(story);
    const candidate = assertCandidateStory(
      story,
      catchupCandidates.get(story.event_id),
      "catch_up",
    );
    if (story.catchup_reason !== candidate.selection_reason) {
      throw new Error(
        `catch_up.${story.id}.catchup_reason must match candidate selection_reason ${candidate.selection_reason}.`,
      );
    }
    assertEqual(
      story.original_event_date,
      candidate.first_seen_at.slice(0, 10),
      `catch_up.${story.id}.original_event_date`,
    );
  }

  for (const [prefix, count] of [
    ["market-macro-pulse", edition.market_macro_pulse.length],
    ["next-7-days", edition.next_7_days.length],
    ["weak-signal", edition.weak_signals.length],
  ] as const) {
    for (let rank = 0; rank < count; rank += 1) {
      const generatedId = `${prefix}-${rank}`;
      if (itemIds.has(generatedId)) {
        throw new Error(
          `Edition item id ${generatedId} conflicts with a generated section id.`,
        );
      }
      itemIds.add(generatedId);
    }
  }

  return { edition, bundle };
}

export function loadAndValidateReviewDraft(
  editionPath: string,
  bundlePath: string,
): ValidatedReviewDraft {
  return validateReviewDraft(readJson(editionPath), readJson(bundlePath));
}
