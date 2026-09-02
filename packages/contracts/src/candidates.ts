import { z } from "zod";

import { TopicSchema } from "./schemas.js";

export const ProfileConfigSchema = z
  .object({
    schema_version: z.literal(1),
    profile_id: z.string().min(1),
    profile_version: z.number().int().positive(),
    timezone: z.string().min(1),
    edition: z
      .object({
        publish_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        coverage_hours: z.number().int().positive().max(168),
        catchup_days: z.number().int().positive().max(30),
      })
      .passthrough(),
    topics: z
      .array(
        z
          .object({
            id: TopicSchema,
            label: z.string().min(1),
            weight: z.number().positive().max(1),
            include: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .min(1),
    ranking: z
      .object({
        factors: z
          .object({
            relevance: z.number().positive(),
            impact: z.number().positive(),
            novelty: z.number().positive(),
            confidence: z.number().positive(),
            urgency: z.number().positive(),
          })
          .strict(),
      })
      .passthrough(),
  })
  .passthrough();

export const CandidateDocumentSchema = z
  .object({
    document_id: z.string().min(1),
    source_id: z.string().min(1),
    publisher: z.string().min(1),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    title: z.string().min(1),
    url: z.string().url(),
    published_at: z.string().datetime({ offset: true }).nullable(),
    retrieved_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const RankingSignalsSchema = z
  .object({
    relevance: z.number().min(0).max(1),
    impact: z.number().min(0).max(1),
    novelty: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    urgency: z.number().min(0).max(1),
  })
  .strict();

export const CandidateEventSchema = z
  .object({
    event_id: z.string().min(1),
    topic: TopicSchema,
    headline: z.string().min(1),
    summary_seed: z.string().min(1),
    verification_status: z.enum(["unverified", "multi_source", "confirmed"]),
    severity: z.enum(["critical", "high", "watch"]).nullable(),
    first_seen_at: z.string().datetime({ offset: true }),
    last_updated_at: z.string().datetime({ offset: true }),
    selection_reason: z.enum([
      "current_window",
      "subsequent_confirmation",
      "impact_increased",
      "source_quality_improved",
      "previously_missed",
      "profile_changed",
    ]),
    source_count: z.number().int().positive(),
    independent_source_count: z.number().int().positive(),
    tier_1_source_count: z.number().int().nonnegative(),
    ranking_signals: RankingSignalsSchema,
    internal_priority: z.number().min(0).max(1),
    documents: z.array(CandidateDocumentSchema).min(1),
  })
  .strict();

export const CandidateBundleSchema = z
  .object({
    schema_version: z.literal("1.0"),
    bundle_id: z.string().min(1),
    edition_date: z.string().date(),
    timezone: z.string().min(1),
    profile_id: z.string().min(1),
    profile_version: z.number().int().positive(),
    generated_at: z.string().datetime({ offset: true }),
    window: z
      .object({
        current_start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        catchup_start: z.string().datetime({ offset: true }),
      })
      .strict(),
    coverage_health: z
      .object({
        configured_sources: z.number().int().nonnegative(),
        sources_with_documents: z.number().int().nonnegative(),
        sources_failed: z.number().int().nonnegative(),
        failed_source_ids: z.array(z.string()),
        notes: z.array(z.string()),
      })
      .strict(),
    current_24h: z.array(CandidateEventSchema),
    catch_up_7d: z.array(CandidateEventSchema),
    suppressed: z.array(
      z
        .object({
          event_id: z.string().min(1),
          topic: TopicSchema,
          headline: z.string().min(1),
          reason: z.enum([
            "low_severity_alert",
            "low_relevance",
            "previously_published",
            "outside_window",
          ]),
        })
        .strict(),
    ),
    stats: z
      .object({
        documents_considered: z.number().int().nonnegative(),
        event_clusters: z.number().int().nonnegative(),
        current_candidates: z.number().int().nonnegative(),
        catchup_candidates: z.number().int().nonnegative(),
        suppressed_candidates: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export function parseCandidateBundle(value: unknown): CandidateBundle {
  return CandidateBundleSchema.parse(value);
}

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;
export type CandidateDocument = z.infer<typeof CandidateDocumentSchema>;
export type RankingSignals = z.infer<typeof RankingSignalsSchema>;
export type CandidateEvent = z.infer<typeof CandidateEventSchema>;
export type CandidateBundle = z.infer<typeof CandidateBundleSchema>;
