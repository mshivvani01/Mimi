-- Migration 001: initial Phase 01 schema.
-- Activity is stored as non-overlapping timestamped segments. Daily/app aggregates are computed from
-- this single table with SQL (one source of truth; no summary tables that could drift out of sync).

CREATE TABLE activity_segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('active','idle','unknown')),
  reason        TEXT    NOT NULL DEFAULT 'none',
  app_id        TEXT,                       -- normalised exe name, e.g. 'chrome.exe' (never a full path)
  app_name      TEXT,                       -- friendly display name
  start_ts      INTEGER NOT NULL,           -- wall-clock epoch ms at segment start
  end_ts        INTEGER NOT NULL,           -- start_ts + duration_ms (kept consistent even across clock changes)
  duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0), -- measured with a monotonic clock
  local_date    TEXT    NOT NULL,           -- local calendar date (YYYY-MM-DD) of start_ts; segments never span midnight
  tz_offset_min INTEGER NOT NULL DEFAULT 0, -- minutes east of UTC when the segment started
  is_open       INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0,1)),
  recovered     INTEGER NOT NULL DEFAULT 0 CHECK (recovered IN (0,1)), -- closed by crash recovery
  run_id        TEXT    NOT NULL            -- which app run wrote it
);

-- At most one open segment can exist at any time: prevents duplicate monitoring loops from double-recording.
CREATE UNIQUE INDEX ux_activity_one_open ON activity_segments (is_open) WHERE is_open = 1;
CREATE INDEX ix_activity_date_kind ON activity_segments (local_date, kind);
CREATE INDEX ix_activity_date_app  ON activity_segments (local_date, app_id) WHERE kind = 'active';
CREATE INDEX ix_activity_start     ON activity_segments (start_ts);

CREATE TABLE monitor_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL   -- JSON-encoded scalar
);
