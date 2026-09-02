#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadProfile, prepareCandidates } from "@morning-signal/candidates";
import { collectFeeds, loadSourcesConfig } from "@morning-signal/collector";
import { openNewsStore } from "@morning-signal/storage";

import { createDryRunEdition, getWorkerHealth } from "./run.js";
import { loadAndValidateReviewDraft } from "./draft.js";
import { createDashboardApiServer } from "./api.js";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionValues(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1] as string] : [],
  );
}

function projectRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function resolveFromProject(path: string): string {
  return resolve(projectRoot(), path);
}

export function defaultDataDirectory(): string {
  return resolve(projectRoot(), process.env.MORNING_SIGNAL_DATA_DIR ?? "data");
}

export function defaultSourcesConfigPath(): string {
  return resolve(projectRoot(), "config/sources.yaml");
}

export function defaultProfilePath(): string {
  return resolve(projectRoot(), "config/profile.yaml");
}

export function defaultDatabasePath(): string {
  return resolve(defaultDataDirectory(), "morning-signal.db");
}

function runDatabaseCommand(args: string[]): number {
  const action = args[1];
  if (action !== "init" && action !== "status") {
    return 1;
  }

  const configuredPath = optionValue(args, "--path");
  const databasePath = configuredPath
    ? resolveFromProject(configuredPath)
    : defaultDatabasePath();
  const store = openNewsStore(databasePath);

  try {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          action,
          databasePath: store.path,
          schemaVersion: store.migrations.at(-1)?.version ?? 0,
          migrations: store.migrations,
          stats: store.repository.getStats(),
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    store.close();
  }
}

function runDailyCommand(args: string[]): number {
  const action = args[1];
  if (action !== "preflight") {
    return 1;
  }

  const configuredDatabasePath = optionValue(args, "--path");
  const configuredProfilePath = optionValue(args, "--profile");
  const databasePath = configuredDatabasePath
    ? resolveFromProject(configuredDatabasePath)
    : defaultDatabasePath();
  const profilePath = configuredProfilePath
    ? resolveFromProject(configuredProfilePath)
    : defaultProfilePath();
  const editionDate = optionValue(args, "--date") ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(editionDate)) {
    throw new Error(`Invalid edition date: ${editionDate}`);
  }

  const profile = loadProfile(profilePath).config;
  const store = openNewsStore(databasePath);

  try {
    const existing = store.repository.getEditionByDate(
      editionDate,
      profile.profile_version,
    );
    console.log(
      JSON.stringify(
        {
          status: existing ? "already_exists" : "ready",
          editionDate,
          timezone: profile.timezone,
          profileId: profile.profile_id,
          profileVersion: profile.profile_version,
          databasePath: store.path,
          existingEdition: existing
            ? {
                editionId: existing.edition_id,
                status: existing.status,
                generatedAt: existing.generated_at,
                publishedAt: existing.published_at,
              }
            : null,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    store.close();
  }
}

async function runCollectionCommand(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const configuredDatabasePath = optionValue(args, "--path");
  const configuredConfigPath = optionValue(args, "--config");
  const configuredDataDirectory = optionValue(args, "--data-dir");
  const databasePath = configuredDatabasePath
    ? resolveFromProject(configuredDatabasePath)
    : defaultDatabasePath();
  const configPath = configuredConfigPath
    ? resolveFromProject(configuredConfigPath)
    : defaultSourcesConfigPath();
  const dataDirectory = configuredDataDirectory
    ? resolveFromProject(configuredDataDirectory)
    : dirname(databasePath);
  const sourceIds = optionValues(args, "--source");
  const config = loadSourcesConfig(configPath);
  const store = openNewsStore(dryRun ? ":memory:" : databasePath);

  try {
    const summary = await collectFeeds({
      config,
      repository: store.repository,
      dataDirectory,
      sourceIds,
      dryRun,
    });
    console.log(JSON.stringify(summary, null, 2));
    return summary.status === "completed" ? 0 : 2;
  } finally {
    store.close();
  }
}

function listSources(args: string[]): number {
  const configuredDatabasePath = optionValue(args, "--path");
  const configuredConfigPath = optionValue(args, "--config");
  const databasePath = configuredDatabasePath
    ? resolveFromProject(configuredDatabasePath)
    : defaultDatabasePath();
  const configPath = configuredConfigPath
    ? resolveFromProject(configuredConfigPath)
    : defaultSourcesConfigPath();
  const config = loadSourcesConfig(configPath);
  const store = openNewsStore(databasePath);

  try {
    console.log(
      JSON.stringify(
        {
          configPath,
          sources: config.sources.map((source) => ({
            id: source.id,
            name: source.name,
            enabled: source.enabled,
            tier: source.tier,
            topics: source.topics,
            feedUrl: source.feed_url,
            fetchState: store.repository.getSourceFetchState(source.id),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    store.close();
  }
}

function prepareCandidateBundle(args: string[]): number {
  const configuredDatabasePath = optionValue(args, "--path");
  const configuredSourcesPath = optionValue(args, "--sources-config");
  const configuredProfilePath = optionValue(args, "--profile");
  const configuredDataDirectory = optionValue(args, "--data-dir");
  const databasePath = configuredDatabasePath
    ? resolveFromProject(configuredDatabasePath)
    : defaultDatabasePath();
  const dataDirectory = configuredDataDirectory
    ? resolveFromProject(configuredDataDirectory)
    : dirname(databasePath);
  const sourcesPath = configuredSourcesPath
    ? resolveFromProject(configuredSourcesPath)
    : defaultSourcesConfigPath();
  const profilePath = configuredProfilePath
    ? resolveFromProject(configuredProfilePath)
    : defaultProfilePath();
  const editionDate = optionValue(args, "--date") ?? today();
  const store = openNewsStore(databasePath);

  try {
    const prepared = prepareCandidates({
      repository: store.repository,
      profile: loadProfile(profilePath),
      sources: loadSourcesConfig(sourcesPath),
      editionDate,
      dataDirectory,
    });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          bundleId: prepared.bundle.bundle_id,
          editionDate: prepared.bundle.edition_date,
          filePath: resolve(dataDirectory, prepared.filePath),
          window: prepared.bundle.window,
          coverageHealth: prepared.bundle.coverage_health,
          stats: prepared.bundle.stats,
          topCurrentCandidates: prepared.bundle.current_24h
            .slice(0, 5)
            .map((candidate) => ({
              eventId: candidate.event_id,
              topic: candidate.topic,
              headline: candidate.headline,
              verificationStatus: candidate.verification_status,
              internalPriority: candidate.internal_priority,
            })),
          topCatchupCandidates: prepared.bundle.catch_up_7d
            .slice(0, 5)
            .map((candidate) => ({
              eventId: candidate.event_id,
              topic: candidate.topic,
              headline: candidate.headline,
              verificationStatus: candidate.verification_status,
              internalPriority: candidate.internal_priority,
            })),
        },
        null,
        2,
      ),
    );
    return prepared.bundle.coverage_health.sources_failed > 0 ? 2 : 0;
  } finally {
    store.close();
  }
}

function runDraftCommand(args: string[]): number {
  const action = args[1];
  if (action !== "validate" && action !== "import") {
    return 1;
  }

  const input = optionValue(args, "--input");
  const bundle = optionValue(args, "--bundle");
  if (!input || !bundle) {
    throw new Error("draft requires --input FILE and --bundle FILE.");
  }

  const inputPath = resolveFromProject(input);
  const bundlePath = resolveFromProject(bundle);
  const validated = loadAndValidateReviewDraft(inputPath, bundlePath);

  if (action === "validate") {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          action,
          inputPath,
          bundlePath,
          editionId: validated.edition.edition_id,
          editionStatus: validated.edition.status,
          selected: {
            riskAlerts: validated.edition.risk_alerts.length,
            mustRead: validated.edition.must_read.length,
            catchUp: validated.edition.catch_up.length,
          },
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const configuredDatabasePath = optionValue(args, "--path");
  const databasePath = configuredDatabasePath
    ? resolveFromProject(configuredDatabasePath)
    : defaultDatabasePath();
  const store = openNewsStore(databasePath);

  try {
    const edition = store.repository.saveEdition(validated.edition, {
      createOnly: true,
    });
    store.repository.saveRun({
      id: validated.bundle.bundle_id,
      editionDate: validated.bundle.edition_date,
      profileId: validated.bundle.profile_id,
      profileVersion: validated.bundle.profile_version,
      status: "review_required",
      stage: "editorial_review",
      startedAt: validated.bundle.generated_at,
      completedAt: edition.generated_at,
      metrics: {
        editionId: edition.edition_id,
        riskAlerts: edition.risk_alerts.length,
        mustRead: edition.must_read.length,
        catchUp: edition.catch_up.length,
      },
    });
    console.log(
      JSON.stringify(
        {
          status: "ok",
          action,
          databasePath: store.path,
          editionId: edition.edition_id,
          editionStatus: edition.status,
          publishedAt: edition.published_at,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    store.close();
  }
}

async function runServeCommand(args: string[]): Promise<number> {
  const configuredPort = optionValue(args, "--port");
  const port = configuredPort === undefined ? 8787 : Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid API port: ${configuredPort ?? ""}`);
  }

  const configuredDatabasePath = optionValue(args, "--path");
  const databasePath = configuredDatabasePath
    ? resolveFromProject(configuredDatabasePath)
    : defaultDatabasePath();
  const store = openNewsStore(databasePath);
  const server = createDashboardApiServer(store);

  try {
    await new Promise<void>((resolveListening, rejectListening) => {
      server.once("error", rejectListening);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", rejectListening);
        resolveListening();
      });
    });
  } catch (error) {
    store.close();
    throw error;
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        service: "dashboard-api",
        url: `http://127.0.0.1:${port}`,
        databasePath: store.path,
        automaticPublishEnabled: false,
      },
      null,
      2,
    ),
  );

  return new Promise<number>((resolveStopped) => {
    let stopping = false;
    const stop = () => {
      if (stopping) {
        return;
      }
      stopping = true;
      server.close(() => {
        store.close();
        resolveStopped(0);
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function main(args: string[]): Promise<number> {
  const [command] = args;

  if (command === "health") {
    console.log(JSON.stringify(getWorkerHealth(), null, 2));
    return 0;
  }

  if (command === "run" && args.includes("--dry-run")) {
    const date = optionValue(args, "--date") ?? today();
    console.log(JSON.stringify(createDryRunEdition(date), null, 2));
    return 0;
  }

  if (command === "db") {
    const result = runDatabaseCommand(args);
    if (result === 0) {
      return result;
    }
  }

  if (command === "daily") {
    const result = runDailyCommand(args);
    if (result === 0) {
      return result;
    }
  }

  if (command === "collect") {
    return runCollectionCommand(args);
  }

  if (command === "sources") {
    return listSources(args);
  }

  if (command === "prepare") {
    return prepareCandidateBundle(args);
  }

  if (command === "draft") {
    const result = runDraftCommand(args);
    if (result === 0) {
      return result;
    }
  }

  if (command === "serve") {
    return runServeCommand(args);
  }

  console.error(
    "Usage: worker <health | serve [--port NUMBER] [--path DB] | run --dry-run [--date YYYY-MM-DD] | daily preflight [--date YYYY-MM-DD] [--profile FILE] [--path DB] | collect [--source ID] [--dry-run] [--config FILE] [--path DB] [--data-dir DIR] | sources | prepare [--date YYYY-MM-DD] [--profile FILE] [--sources-config FILE] [--path DB] [--data-dir DIR] | draft <validate|import> --input FILE --bundle FILE [--path DB] | db <init|status> [--path FILE]>",
  );
  return 1;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
