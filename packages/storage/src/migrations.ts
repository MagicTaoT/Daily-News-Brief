export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "core_news_model",
    sql: `
      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
        kind TEXT NOT NULL CHECK (kind IN ('rss', 'website', 'api', 'social', 'manual')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id),
        url TEXT NOT NULL UNIQUE,
        canonical_url TEXT,
        title TEXT NOT NULL,
        author TEXT,
        published_at TEXT,
        retrieved_at TEXT NOT NULL,
        language TEXT,
        body TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        raw_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL CHECK (topic IN (
          'mev', 'defi', 'crypto_security', 'market_structure',
          'ai_finance_crypto', 'macro', 'regulation', 'black_swan'
        )),
        headline TEXT NOT NULL,
        summary TEXT NOT NULL,
        verification_status TEXT NOT NULL CHECK (verification_status IN (
          'unverified', 'multi_source', 'confirmed', 'disputed', 'resolved'
        )),
        severity TEXT CHECK (severity IN ('critical', 'high', 'watch')),
        lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN (
          'active', 'resolved', 'disputed'
        )),
        first_seen_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE event_documents (
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL DEFAULT 'supports' CHECK (relationship IN (
          'supports', 'contradicts', 'context'
        )),
        linked_at TEXT NOT NULL,
        PRIMARY KEY (event_id, document_id)
      ) STRICT;

      CREATE TABLE event_updates (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        observed_at TEXT NOT NULL,
        update_type TEXT NOT NULL CHECK (update_type IN (
          'discovered', 'confirmed', 'developed', 'corrected', 'resolved'
        )),
        summary TEXT NOT NULL,
        source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
        payload_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE profile_versions (
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        config_yaml TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, version),
        UNIQUE (profile_id, config_hash)
      ) STRICT;

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        edition_date TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_version INTEGER NOT NULL CHECK (profile_version > 0),
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'collecting', 'analyzing', 'review_required',
          'completed', 'failed'
        )),
        stage TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT,
        metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
        FOREIGN KEY (profile_id, profile_version)
          REFERENCES profile_versions(profile_id, version)
      ) STRICT;

      CREATE TABLE editions (
        edition_id TEXT PRIMARY KEY,
        edition_date TEXT NOT NULL,
        profile_version INTEGER NOT NULL CHECK (profile_version > 0),
        status TEXT NOT NULL CHECK (status IN (
          'collecting', 'analyzing', 'review_required', 'needs_attention',
          'approved', 'published', 'revised', 'failed'
        )),
        generated_at TEXT NOT NULL,
        published_at TEXT,
        run_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
        supersedes_edition_id TEXT REFERENCES editions(edition_id),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (edition_date, profile_version, revision_number)
      ) STRICT;

      CREATE TABLE edition_items (
        edition_id TEXT NOT NULL REFERENCES editions(edition_id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        event_id TEXT,
        section TEXT NOT NULL CHECK (section IN (
          'risk_alerts', 'must_read', 'catch_up', 'market_macro_pulse',
          'next_7_days', 'weak_signals'
        )),
        rank INTEGER NOT NULL CHECK (rank >= 0),
        topic TEXT,
        headline TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        PRIMARY KEY (edition_id, item_id)
      ) STRICT;

      CREATE TABLE citations (
        edition_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        citation_index INTEGER NOT NULL CHECK (citation_index >= 0),
        source_id TEXT NOT NULL,
        document_id TEXT REFERENCES documents(id),
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        publisher TEXT NOT NULL,
        published_at TEXT,
        retrieved_at TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
        PRIMARY KEY (edition_id, item_id, citation_index),
        FOREIGN KEY (edition_id, item_id)
          REFERENCES edition_items(edition_id, item_id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE feedback (
        id TEXT PRIMARY KEY,
        edition_id TEXT NOT NULL REFERENCES editions(edition_id) ON DELETE CASCADE,
        item_id TEXT,
        action TEXT NOT NULL CHECK (action IN (
          'useful', 'not_useful', 'promote', 'demote', 'correction', 'note'
        )),
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX documents_source_published_idx
        ON documents(source_id, published_at DESC);
      CREATE INDEX events_topic_updated_idx
        ON events(topic, last_updated_at DESC);
      CREATE INDEX events_lifecycle_updated_idx
        ON events(lifecycle_status, last_updated_at DESC);
      CREATE INDEX event_updates_event_observed_idx
        ON event_updates(event_id, observed_at DESC);
      CREATE INDEX runs_edition_date_idx
        ON runs(edition_date DESC, started_at DESC);
      CREATE INDEX editions_date_revision_idx
        ON editions(edition_date DESC, revision_number DESC);
      CREATE INDEX edition_items_event_idx
        ON edition_items(event_id);
      CREATE INDEX citations_source_idx
        ON citations(source_id);

      CREATE TRIGGER editions_prevent_published_update
      BEFORE UPDATE ON editions
      WHEN OLD.status IN ('published', 'revised')
      BEGIN
        SELECT RAISE(ABORT, 'published editions are immutable; create a revision');
      END;

      CREATE TRIGGER editions_prevent_published_delete
      BEFORE DELETE ON editions
      WHEN OLD.status IN ('published', 'revised')
      BEGIN
        SELECT RAISE(ABORT, 'published editions are immutable; create a revision');
      END;
    `,
  },
  {
    version: 2,
    name: "full_text_search",
    sql: `
      CREATE VIRTUAL TABLE documents_fts USING fts5(
        title,
        body,
        content='documents',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE VIRTUAL TABLE events_fts USING fts5(
        headline,
        summary,
        content='events',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE VIRTUAL TABLE edition_items_fts USING fts5(
        headline,
        summary,
        content='edition_items',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;
      CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
      END;
      CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO documents_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER events_fts_insert AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(rowid, headline, summary)
        VALUES (new.rowid, new.headline, new.summary);
      END;
      CREATE TRIGGER events_fts_delete AFTER DELETE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, headline, summary)
        VALUES ('delete', old.rowid, old.headline, old.summary);
      END;
      CREATE TRIGGER events_fts_update AFTER UPDATE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, headline, summary)
        VALUES ('delete', old.rowid, old.headline, old.summary);
        INSERT INTO events_fts(rowid, headline, summary)
        VALUES (new.rowid, new.headline, new.summary);
      END;

      CREATE TRIGGER edition_items_fts_insert AFTER INSERT ON edition_items BEGIN
        INSERT INTO edition_items_fts(rowid, headline, summary)
        VALUES (new.rowid, new.headline, new.summary);
      END;
      CREATE TRIGGER edition_items_fts_delete AFTER DELETE ON edition_items BEGIN
        INSERT INTO edition_items_fts(edition_items_fts, rowid, headline, summary)
        VALUES ('delete', old.rowid, old.headline, old.summary);
      END;
      CREATE TRIGGER edition_items_fts_update AFTER UPDATE ON edition_items BEGIN
        INSERT INTO edition_items_fts(edition_items_fts, rowid, headline, summary)
        VALUES ('delete', old.rowid, old.headline, old.summary);
        INSERT INTO edition_items_fts(rowid, headline, summary)
        VALUES (new.rowid, new.headline, new.summary);
      END;

      INSERT INTO documents_fts(documents_fts) VALUES ('rebuild');
      INSERT INTO events_fts(events_fts) VALUES ('rebuild');
      INSERT INTO edition_items_fts(edition_items_fts) VALUES ('rebuild');
    `,
  },
  {
    version: 3,
    name: "collection_tracking",
    sql: `
      CREATE TABLE collection_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
        source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
        success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
        failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
        not_modified_count INTEGER NOT NULL DEFAULT 0 CHECK (not_modified_count >= 0),
        new_document_count INTEGER NOT NULL DEFAULT 0 CHECK (new_document_count >= 0),
        duplicate_document_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_document_count >= 0),
        dry_run INTEGER NOT NULL DEFAULT 0 CHECK (dry_run IN (0, 1))
      ) STRICT;

      CREATE TABLE source_fetch_state (
        source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
        etag TEXT,
        last_modified TEXT,
        last_attempt_at TEXT NOT NULL,
        last_success_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
        last_error TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE collection_attempts (
        id TEXT PRIMARY KEY,
        collection_run_id TEXT NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES sources(id),
        status TEXT NOT NULL CHECK (status IN ('success', 'not_modified', 'failed')),
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        http_status INTEGER,
        raw_path TEXT,
        items_seen INTEGER NOT NULL DEFAULT 0 CHECK (items_seen >= 0),
        new_document_count INTEGER NOT NULL DEFAULT 0 CHECK (new_document_count >= 0),
        duplicate_document_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_document_count >= 0),
        error_message TEXT
      ) STRICT;

      CREATE INDEX collection_runs_started_idx
        ON collection_runs(started_at DESC);
      CREATE INDEX collection_attempts_run_idx
        ON collection_attempts(collection_run_id, source_id);
      CREATE INDEX source_fetch_state_failures_idx
        ON source_fetch_state(consecutive_failures DESC, last_attempt_at DESC);
    `,
  },
  {
    version: 4,
    name: "analysis_bundles",
    sql: `
      CREATE TABLE analysis_bundles (
        bundle_id TEXT PRIMARY KEY,
        edition_date TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_version INTEGER NOT NULL CHECK (profile_version > 0),
        generated_at TEXT NOT NULL,
        current_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        catchup_start TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'consumed')),
        file_path TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX analysis_bundles_edition_idx
        ON analysis_bundles(edition_date DESC, generated_at DESC);

      CREATE TRIGGER analysis_bundles_prevent_update
      BEFORE UPDATE ON analysis_bundles
      BEGIN
        SELECT RAISE(ABORT, 'analysis bundles are immutable');
      END;

      CREATE TRIGGER analysis_bundles_prevent_delete
      BEFORE DELETE ON analysis_bundles
      BEGIN
        SELECT RAISE(ABORT, 'analysis bundles are immutable');
      END;
    `,
  },
] as const;
