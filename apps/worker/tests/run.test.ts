import { describe, expect, it } from "vitest";

import { createDryRunEdition, getWorkerHealth } from "../src/run.js";

describe("worker scaffold", () => {
  it("reports a safe local execution backend", () => {
    expect(getWorkerHealth()).toMatchObject({
      status: "ok",
      executionBackend: "codex_local_automation",
      automaticPublishEnabled: false,
    });
  });

  it("creates a review-only dry-run edition", () => {
    const edition = createDryRunEdition("2026-09-01");

    expect(edition.status).toBe("review_required");
    expect(edition.published_at).toBeNull();
    expect(edition.coverage.catchup_start).toContain("2026-08-25");
    expect(edition.must_read).toEqual([]);
  });

  it("rejects an invalid edition date", () => {
    expect(() => createDryRunEdition("September 1")).toThrow(
      "Invalid edition date",
    );
  });
});
