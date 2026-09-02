import { openDatabase, type OpenedDatabase } from "./database.js";
import { NewsRepository } from "./repository.js";

export { applyMigrations, openDatabase } from "./database.js";
export { MIGRATIONS } from "./migrations.js";
export { NewsRepository } from "./repository.js";
export type { Migration } from "./migrations.js";
export type { MigrationRecord, OpenedDatabase } from "./database.js";
export type {
  AnalysisDocument,
  CollectionAttemptInput,
  CollectionRunInput,
  CollectionRunResult,
  DocumentInput,
  EditionSummary,
  EventInput,
  EventLifecycleStatus,
  EventRelationship,
  EventSearchResult,
  EventUpdateInput,
  EventUpdateType,
  ProfileVersionInput,
  RunInput,
  SourceInput,
  SourceFetchState,
  SourceKind,
  SourceTier,
  StorageStats,
} from "./repository.js";

export interface NewsStore extends OpenedDatabase {
  readonly repository: NewsRepository;
}

export function openNewsStore(path: string): NewsStore {
  const opened = openDatabase(path);
  return {
    ...opened,
    repository: new NewsRepository(opened.database),
  };
}
