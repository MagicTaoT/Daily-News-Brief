import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EditionSchema, parseEdition } from "../src/index.js";

const examplePath = fileURLToPath(
  new URL("../../../examples/edition.example.json", import.meta.url),
);

describe("EditionSchema", () => {
  it("accepts the canonical example edition", () => {
    const example = JSON.parse(readFileSync(examplePath, "utf8")) as unknown;

    expect(() => parseEdition(example)).not.toThrow();
  });

  it("rejects an unpublished edition with a publication timestamp", () => {
    const example = JSON.parse(readFileSync(examplePath, "utf8")) as Record<
      string,
      unknown
    >;
    example.published_at = "2026-09-01T07:00:00-07:00";

    const result = EditionSchema.safeParse(example);

    expect(result.success).toBe(false);
  });

  it("rejects a core story without citations", () => {
    const example = JSON.parse(readFileSync(examplePath, "utf8")) as {
      must_read: Array<Record<string, unknown>>;
    };
    if (example.must_read[0]) {
      example.must_read[0].citations = [];
    }

    const result = EditionSchema.safeParse(example);

    expect(result.success).toBe(false);
  });
});
