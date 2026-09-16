import type {
  CandidateBundle,
  Citation,
  Edition,
  Story,
} from "@morning-signal/contracts";
import { describe, expect, it } from "vitest";

import { createPublishedRevision, validateReviewDraft } from "../src/draft.js";

const citation: Citation = {
  source_id: "sec",
  title: "Primary source",
  url: "https://example.com/primary",
  publisher: "SEC",
  published_at: "2026-09-01T16:00:00Z",
  retrieved_at: "2026-09-02T05:00:00Z",
  tier: 1,
};

const bundle: CandidateBundle = {
  schema_version: "1.0",
  bundle_id: "candidates-2026-09-02-test",
  edition_date: "2026-09-02",
  timezone: "America/Los_Angeles",
  profile_id: "daniel-default",
  profile_version: 1,
  generated_at: "2026-09-02T06:00:00Z",
  window: {
    current_start: "2026-09-01T14:00:00Z",
    end: "2026-09-02T14:00:00Z",
    catchup_start: "2026-08-26T14:00:00Z",
  },
  coverage_health: {
    configured_sources: 10,
    sources_with_documents: 1,
    sources_failed: 0,
    failed_source_ids: [],
    notes: [],
  },
  current_24h: [
    {
      event_id: "event-current",
      topic: "market_structure",
      headline: "Primary source",
      summary_seed: "A primary source announced a market-structure proposal.",
      verification_status: "confirmed",
      severity: null,
      first_seen_at: "2026-09-01T16:00:00Z",
      last_updated_at: "2026-09-01T16:00:00Z",
      selection_reason: "current_window",
      source_count: 1,
      independent_source_count: 1,
      tier_1_source_count: 1,
      ranking_signals: {
        relevance: 1,
        impact: 0.8,
        novelty: 0.8,
        confidence: 1,
        urgency: 0.5,
      },
      internal_priority: 0.8,
      documents: [
        {
          document_id: "doc-current",
          source_id: citation.source_id,
          publisher: citation.publisher,
          tier: citation.tier,
          title: citation.title,
          url: citation.url,
          published_at: citation.published_at,
          retrieved_at: citation.retrieved_at,
        },
      ],
    },
  ],
  catch_up_7d: [],
  suppressed: [],
  stats: {
    documents_considered: 1,
    event_clusters: 1,
    current_candidates: 1,
    catchup_candidates: 0,
    suppressed_candidates: 0,
  },
};

const story: Story = {
  id: "story-current",
  event_id: "event-current",
  topic: "market_structure",
  headline: "A proposal changes market infrastructure",
  what_happened: "The authority published a proposal.",
  why_it_matters: "The change could affect settlement infrastructure.",
  new_since_last_summary: "This is the first appearance in the current window.",
  what_to_watch: "Watch the consultation and final rule.",
  impact_label: "mixed",
  verification_status: "confirmed",
  first_seen_at: "2026-09-01T16:00:00Z",
  last_updated_at: "2026-09-01T16:00:00Z",
  citations: [citation],
};

function validEdition(): Edition {
  return {
    schema_version: "1.0",
    edition_id: "2026-09-02-daniel-default-v1",
    edition_date: "2026-09-02",
    timezone: "America/Los_Angeles",
    coverage: {
      start: bundle.window.current_start,
      end: bundle.window.end,
      catchup_start: bundle.window.catchup_start,
    },
    profile_version: 1,
    status: "review_required",
    generated_at: "2026-09-02T06:30:00Z",
    published_at: null,
    run_id: bundle.bundle_id,
    executive_summary: "A review-only test edition.",
    risk_alerts: [],
    must_read: [story],
    catch_up: [],
    market_macro_pulse: [],
    next_7_days: [],
    weak_signals: [],
    coverage_health: {
      status: "partial",
      sources_checked: 10,
      sources_failed: 0,
      notes: ["Test coverage is intentionally narrow."],
    },
    revision: null,
  };
}

describe("review draft gate", () => {
  it("accepts a traceable review-only draft", () => {
    expect(validateReviewDraft(validEdition(), bundle).edition).toMatchObject({
      status: "review_required",
      run_id: bundle.bundle_id,
    });
  });

  it("rejects publication and mismatched candidate provenance", () => {
    expect(() =>
      validateReviewDraft(
        {
          ...validEdition(),
          status: "published",
          published_at: "2026-09-02T07:00:00-07:00",
        },
        bundle,
      ),
    ).toThrow("status must match");

    expect(() =>
      validateReviewDraft(
        {
          ...validEdition(),
          must_read: [
            {
              ...story,
              citations: [{ ...citation, title: "Invented citation title" }],
            },
          ],
        },
        bundle,
      ),
    ).toThrow("must cite at least one document");
  });

  it("rejects verification upgrades outside the provenance pipeline", () => {
    const unverifiedBundle: CandidateBundle = {
      ...bundle,
      current_24h: [
        {
          ...bundle.current_24h[0]!,
          verification_status: "unverified",
          tier_1_source_count: 0,
        },
      ],
    };

    expect(() => validateReviewDraft(validEdition(), unverifiedBundle)).toThrow(
      "verification_status must remain unverified",
    );
  });

  it("allows at most one must-read item per protocol", () => {
    const aaveCitation = {
      ...citation,
      source_id: "aave-governance",
      title: "Aave proposal one",
      url: "https://governance.aave.com/t/proposal-one/1",
      publisher: "Aave Governance",
      tier: 3 as const,
    };
    const secondCitation = {
      ...aaveCitation,
      title: "Aave proposal two",
      url: "https://governance.aave.com/t/proposal-two/2",
    };
    const firstCandidate = {
      ...bundle.current_24h[0]!,
      event_id: "aave-event-one",
      headline: "Aave proposal one",
      verification_status: "unverified" as const,
      tier_1_source_count: 0,
      documents: [
        {
          ...bundle.current_24h[0]!.documents[0]!,
          document_id: "aave-doc-one",
          source_id: aaveCitation.source_id,
          publisher: aaveCitation.publisher,
          tier: aaveCitation.tier,
          title: aaveCitation.title,
          url: aaveCitation.url,
        },
      ],
    };
    const secondCandidate = {
      ...firstCandidate,
      event_id: "aave-event-two",
      headline: "Aave proposal two",
      documents: [
        {
          ...firstCandidate.documents[0]!,
          document_id: "aave-doc-two",
          title: secondCitation.title,
          url: secondCitation.url,
        },
      ],
    };
    const aaveBundle = {
      ...bundle,
      current_24h: [firstCandidate, secondCandidate],
    };
    const firstStory = {
      ...story,
      id: "aave-story-one",
      event_id: firstCandidate.event_id,
      headline: firstCandidate.headline,
      verification_status: "unverified" as const,
      citations: [aaveCitation],
    };
    const secondStory = {
      ...firstStory,
      id: "aave-story-two",
      event_id: secondCandidate.event_id,
      headline: secondCandidate.headline,
      citations: [secondCitation],
    };

    expect(() =>
      validateReviewDraft(
        { ...validEdition(), must_read: [firstStory, secondStory] },
        aaveBundle,
      ),
    ).toThrow("more than one core item for protocol aave");
  });

  it("creates a visible immutable revision from a validated draft", () => {
    const validated = validateReviewDraft(validEdition(), bundle);
    const previous: Edition = {
      ...validEdition(),
      status: "published",
      published_at: "2026-09-02T14:00:00Z",
    };
    expect(
      createPublishedRevision(
        validated,
        previous,
        "Added newly discovered primary sources.",
        "2026-09-02T15:00:00Z",
      ),
    ).toMatchObject({
      edition_id: "2026-09-02-daniel-default-v2",
      status: "revised",
      published_at: "2026-09-02T15:00:00Z",
      revision: {
        number: 2,
        revised_at: "2026-09-02T15:00:00Z",
        reason: "Added newly discovered primary sources.",
      },
    });
  });
});
