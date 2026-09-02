import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Edition } from "@morning-signal/contracts";
import { openNewsStore } from "@morning-signal/storage";
import { afterEach, describe, expect, it } from "vitest";

import { handleDashboardApiRequest } from "../src/api.js";

const temporaryDirectories: string[] = [];

function openTestStore() {
  const directory = mkdtempSync(join(tmpdir(), "morning-signal-api-"));
  temporaryDirectories.push(directory);
  return openNewsStore(join(directory, "test.db"));
}

function exampleEdition(): Edition {
  return JSON.parse(
    readFileSync(
      new URL("../../../examples/edition.example.json", import.meta.url),
      "utf8",
    ),
  ) as Edition;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local dashboard API", () => {
  it("lists and reads persisted editions", async () => {
    const store = openTestStore();
    store.repository.saveEdition(exampleEdition());

    const list = await handleDashboardApiRequest(store, {
      method: "GET",
      url: "/api/editions",
    });
    const detail = await handleDashboardApiRequest(store, {
      method: "GET",
      url: "/api/editions/2026-09-01",
    });

    expect(list).toMatchObject({
      status: 200,
      body: { editions: [{ editionId: "2026-09-01-daniel-default-v1" }] },
    });
    expect(detail).toMatchObject({
      status: 200,
      body: { edition: { status: "review_required" } },
    });
    store.close();
  });

  it("edits copy while protecting provenance fields", async () => {
    const store = openTestStore();
    const edition = store.repository.saveEdition(exampleEdition());
    const edited = {
      ...edition,
      executive_summary: "人工修订后的执行摘要。",
      must_read: [
        {
          ...edition.must_read[0]!,
          why_it_matters: "人工修订后的影响分析。",
        },
      ],
    };

    const saved = await handleDashboardApiRequest(store, {
      method: "PUT",
      url: "/api/editions/2026-09-01",
      body: edited,
      mutationAuthorized: true,
    });
    const tampered = await handleDashboardApiRequest(store, {
      method: "PUT",
      url: "/api/editions/2026-09-01",
      body: {
        ...edited,
        must_read: [{ ...edited.must_read[0]!, event_id: "event-invented" }],
      },
      mutationAuthorized: true,
    });

    expect(saved).toMatchObject({
      status: 200,
      body: {
        edition: {
          executive_summary: "人工修订后的执行摘要。",
          must_read: [{ why_it_matters: "人工修订后的影响分析。" }],
        },
      },
    });
    expect(tampered).toMatchObject({ status: 400 });
    store.close();
  });

  it("requires the local mutation marker and approval never publishes", async () => {
    const store = openTestStore();
    const edition = store.repository.saveEdition(exampleEdition());
    const denied = await handleDashboardApiRequest(store, {
      method: "PUT",
      url: "/api/editions/2026-09-01",
      body: edition,
    });
    const approved = await handleDashboardApiRequest(store, {
      method: "POST",
      url: "/api/editions/2026-09-01/approve",
      body: {},
      mutationAuthorized: true,
    });
    const editAfterApproval = await handleDashboardApiRequest(store, {
      method: "PUT",
      url: "/api/editions/2026-09-01",
      body: edition,
      mutationAuthorized: true,
    });

    expect(denied).toMatchObject({ status: 403 });
    expect(approved).toMatchObject({
      status: 200,
      body: { edition: { status: "approved", published_at: null } },
    });
    expect(editAfterApproval).toMatchObject({ status: 409 });
    store.close();
  });
});
