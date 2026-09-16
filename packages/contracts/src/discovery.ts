import { z } from "zod";

import { TopicSchema } from "./schemas.js";

export const DiscoveryItemSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().url(),
    publisher: z.string().min(1),
    author: z.string().min(1).nullable().optional(),
    published_at: z.string().datetime({ offset: true }),
    retrieved_at: z.string().datetime({ offset: true }),
    topic: TopicSchema,
    summary: z.string().min(1),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export const DiscoveryReportSchema = z
  .object({
    schema_version: z.literal("1.0"),
    edition_date: z.string().date(),
    timezone: z.literal("America/Los_Angeles"),
    coverage: z
      .object({
        start: z.string().datetime({ offset: true }),
        end: z.string().datetime({ offset: true }),
      })
      .strict(),
    generated_at: z.string().datetime({ offset: true }),
    model: z.string().min(1),
    queries: z.array(z.string().min(1)).min(1),
    items: z.array(DiscoveryItemSchema).max(50),
  })
  .strict()
  .superRefine((report, context) => {
    const start = Date.parse(report.coverage.start);
    const end = Date.parse(report.coverage.end);
    if (end <= start || end - start > 26 * 60 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        message:
          "Discovery coverage must be a forward window of at most 26 hours.",
        path: ["coverage"],
      });
    }

    const urls = new Set<string>();
    for (const [index, item] of report.items.entries()) {
      const publishedAt = Date.parse(item.published_at);
      if (publishedAt < start || publishedAt >= end) {
        context.addIssue({
          code: "custom",
          message:
            "published_at must fall inside the discovery coverage window.",
          path: ["items", index, "published_at"],
        });
      }
      if (urls.has(item.url)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate discovery URL: ${item.url}`,
          path: ["items", index, "url"],
        });
      }
      urls.add(item.url);
    }
  });

export function parseDiscoveryReport(value: unknown): DiscoveryReport {
  return DiscoveryReportSchema.parse(value);
}

export type DiscoveryItem = z.infer<typeof DiscoveryItemSchema>;
export type DiscoveryReport = z.infer<typeof DiscoveryReportSchema>;
