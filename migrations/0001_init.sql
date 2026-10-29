-- A GitHub user/org whose repos are all backed up; new repos are picked up daily.
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL UNIQUE COLLATE NOCASE,
  interval_min INTEGER NOT NULL,
  synced_at INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE repos (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,                 -- host/path, also the R2 key prefix
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  interval_min INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,                 -- set while a backup runs; left set if the run was cut off
  refs_hash TEXT,                     -- skip the download when branches/tags are unchanged
  status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | error
  error TEXT,
  last_checked_at INTEGER,
  last_saved_at INTEGER,
  size INTEGER                        -- bytes of the newest copy
);

CREATE INDEX repos_due ON repos (paused, next_run_at);

-- Portal settings (retention_days, default_interval); missing keys use the defaults in src/settings.ts.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
