import { z } from "zod";

export const TOPIC_IDS = [
  "mev",
  "defi",
  "crypto_security",
  "market_structure",
  "ai_finance_crypto",
  "macro",
  "regulation",
  "black_swan",
] as const;

export const TopicSchema = z.enum(TOPIC_IDS);

export const FeedSourceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    homepage_url: z.string().url(),
    feed_url: z.string().url(),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    kind: z.literal("rss"),
    format: z.enum(["auto", "rss", "atom"]).default("auto"),
    topics: z.array(TopicSchema).min(1),
    enabled: z.boolean().default(true),
    timeout_ms: z.number().int().min(1_000).max(60_000).optional(),
    max_items: z.number().int().min(1).max(200).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const SourcesConfigSchema = z
  .object({
    schema_version: z.literal(1),
    defaults: z
      .object({
        timeout_ms: z.number().int().min(1_000).max(60_000),
        max_items: z.number().int().min(1).max(200),
        max_age_days: z.number().int().min(1).max(30),
        concurrency: z.number().int().min(1).max(8),
        user_agent: z.string().min(1),
      })
      .strict(),
    sources: z.array(FeedSourceSchema).min(1),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set<string>();
    for (const [index, source] of config.sources.entries()) {
      if (ids.has(source.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate source id: ${source.id}`,
          path: ["sources", index, "id"],
        });
      }
      ids.add(source.id);
    }
  });

export const EditionStatusSchema = z.enum([
  "collecting",
  "analyzing",
  "review_required",
  "needs_attention",
  "approved",
  "published",
  "revised",
  "failed",
]);

export const EDITION_STATUS_LABELS = {
  collecting: "采集中",
  analyzing: "分析中",
  review_required: "等待人工审核",
  needs_attention: "需要处理",
  approved: "已批准",
  published: "已发布",
  revised: "已修订",
  failed: "失败",
} as const satisfies Record<z.infer<typeof EditionStatusSchema>, string>;

export const CitationSchema = z
  .object({
    source_id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().url(),
    publisher: z.string().min(1),
    published_at: z.string().datetime({ offset: true }).nullable(),
    retrieved_at: z.string().datetime({ offset: true }),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  })
  .strict();

export const StorySchema = z
  .object({
    id: z.string().min(1),
    event_id: z.string().min(1),
    topic: TopicSchema,
    headline: z.string().min(1),
    what_happened: z.string().min(1),
    why_it_matters: z.string().min(1),
    new_since_last_summary: z.string().min(1),
    what_to_watch: z.string().min(1),
    impact_label: z.enum(["positive", "negative", "mixed", "uncertain"]),
    verification_status: z.enum([
      "unverified",
      "multi_source",
      "confirmed",
      "disputed",
      "resolved",
    ]),
    first_seen_at: z.string().datetime({ offset: true }),
    last_updated_at: z.string().datetime({ offset: true }),
    citations: z.array(CitationSchema).min(1),
  })
  .strict();

export const RiskAlertSchema = StorySchema.extend({
  severity: z.enum(["critical", "high", "watch"]),
}).strict();

export const CatchupStorySchema = StorySchema.extend({
  original_event_date: z.string().date(),
  catchup_reason: z.enum([
    "subsequent_confirmation",
    "impact_increased",
    "source_quality_improved",
    "previously_missed",
    "profile_changed",
  ]),
}).strict();

const PulseSchema = z
  .object({
    name: z.string().min(1),
    direction: z.enum([
      "tightening",
      "easing",
      "rising",
      "falling",
      "stable",
      "mixed",
    ]),
    explanation: z.string().min(1),
    citations: z.array(CitationSchema).min(1),
  })
  .strict();

const CalendarItemSchema = z
  .object({
    date: z.string().date(),
    title: z.string().min(1),
    topic: z.string().min(1),
    why_watch: z.string().min(1),
    citations: z.array(CitationSchema).min(1),
  })
  .strict();

const WeakSignalSchema = z
  .object({
    title: z.string().min(1),
    evidence: z.string().min(1),
    uncertainty: z.string().min(1),
    what_would_confirm: z.string().min(1),
    citations: z.array(CitationSchema).min(1),
  })
  .strict();

export const EditionSchema = z
  .object({
    schema_version: z.literal("1.0"),
    edition_id: z.string().min(1),
    edition_date: z.string().date(),
    timezone: z.literal("America/Los_Angeles"),
    coverage: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
        catchup_start: z.string().datetime({ offset: true }),
      })
      .strict(),
    profile_version: z.number().int().positive(),
    status: EditionStatusSchema,
    generated_at: z.string().datetime({ offset: true }),
    published_at: z.string().datetime({ offset: true }).nullable(),
    run_id: z.string().min(1),
    executive_summary: z.string().min(1),
    risk_alerts: z.array(RiskAlertSchema).max(3),
    must_read: z.array(StorySchema).max(8),
    catch_up: z.array(CatchupStorySchema).max(5),
    market_macro_pulse: z.array(PulseSchema),
    next_7_days: z.array(CalendarItemSchema),
    weak_signals: z.array(WeakSignalSchema),
    coverage_health: z
      .object({
        status: z.enum(["complete", "partial", "degraded"]),
        sources_checked: z.number().int().nonnegative(),
        sources_failed: z.number().int().nonnegative(),
        notes: z.array(z.string()),
      })
      .strict(),
    revision: z
      .object({
        number: z.number().int().positive(),
        revised_at: z.string().datetime({ offset: true }),
        reason: z.string().min(1),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((edition, context) => {
    const isPublished =
      edition.status === "published" || edition.status === "revised";

    if (isPublished && edition.published_at === null) {
      context.addIssue({
        code: "custom",
        message: "Published editions require published_at.",
        path: ["published_at"],
      });
    }

    if (!isPublished && edition.published_at !== null) {
      context.addIssue({
        code: "custom",
        message: "Unpublished editions must not have published_at.",
        path: ["published_at"],
      });
    }
  });

export function parseEdition(value: unknown): Edition {
  return EditionSchema.parse(value);
}

export type Topic = z.infer<typeof TopicSchema>;
export type FeedSource = z.infer<typeof FeedSourceSchema>;
export type SourcesConfig = z.infer<typeof SourcesConfigSchema>;
export type EditionStatus = z.infer<typeof EditionStatusSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type Story = z.infer<typeof StorySchema>;
export type RiskAlert = z.infer<typeof RiskAlertSchema>;
export type CatchupStory = z.infer<typeof CatchupStorySchema>;
export type Edition = z.infer<typeof EditionSchema>;
