import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "./migrations.js";

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

function configureDatabase(database: DatabaseSync, fileBacked: boolean): void {
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");

  if (fileBacked) {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = NORMAL;");
  }
}

export function applyMigrations(database: DatabaseSync): MigrationRecord[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version)),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  return database
    .prepare(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
    )
    .all() as unknown as MigrationRecord[];
}

export interface OpenedDatabase {
  readonly database: DatabaseSync;
  readonly path: string;
  readonly migrations: MigrationRecord[];
  close(): void;
}

export function openDatabase(path: string): OpenedDatabase {
  const normalizedPath = path === ":memory:" ? path : resolve(path);

  if (normalizedPath !== ":memory:") {
    mkdirSync(dirname(normalizedPath), { recursive: true });
  }

  const database = new DatabaseSync(normalizedPath);

  try {
    configureDatabase(database, normalizedPath !== ":memory:");
    const migrations = applyMigrations(database);

    return {
      database,
      path: normalizedPath,
      migrations,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
