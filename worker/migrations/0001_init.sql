CREATE TABLE replays (
  replay_sha256 TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_referenced_at INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  stored_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE
);

CREATE TABLE sessions (
  run_id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  install_ephemeral INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  build TEXT NOT NULL,
  platform TEXT NOT NULL,
  input_class TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  death_cause TEXT,
  wave_reached INTEGER NOT NULL,
  score INTEGER NOT NULL,
  time_played_ms INTEGER NOT NULL,
  burj_health INTEGER NOT NULL,
  shots_fired INTEGER NOT NULL,
  total_kills INTEGER NOT NULL,
  hit_ratio REAL NOT NULL,
  multi_shots INTEGER NOT NULL,
  max_combo INTEGER NOT NULL,
  destroyed_by_type_json TEXT NOT NULL,
  upgrades_json TEXT NOT NULL,
  feedback_emoji TEXT,
  feedback_note TEXT,
  replay_sha256 TEXT,
  replay_omitted_reason TEXT,
  replay_complete_claimed INTEGER NOT NULL DEFAULT 0,
  replay_verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  shared INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL
);

CREATE INDEX idx_sessions_install ON sessions(install_id, received_at DESC);
CREATE INDEX idx_sessions_leaderboard ON sessions(build, score DESC)
  WHERE replay_verified = 1 AND install_ephemeral = 0;
CREATE INDEX idx_sessions_recent ON sessions(received_at DESC);
CREATE INDEX idx_sessions_replay ON sessions(replay_sha256);

CREATE TABLE diagnostic_reports (
  report_id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  install_ephemeral INTEGER NOT NULL DEFAULT 0,
  run_id TEXT,
  boot_id TEXT NOT NULL,
  build TEXT NOT NULL,
  platform TEXT NOT NULL,
  input_class TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  app_screen TEXT NOT NULL,
  trigger TEXT NOT NULL,
  note TEXT,
  partial INTEGER NOT NULL,
  captured_through_tick INTEGER,
  replay_sha256 TEXT,
  replay_source TEXT NOT NULL,
  replay_omitted_reason TEXT,
  events_count INTEGER NOT NULL,
  events_truncated INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  raw_bytes INTEGER NOT NULL,
  stored_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_reports_install ON diagnostic_reports(install_id, received_at DESC);
CREATE INDEX idx_reports_run ON diagnostic_reports(run_id);
CREATE INDEX idx_reports_received ON diagnostic_reports(received_at DESC);
CREATE INDEX idx_reports_replay ON diagnostic_reports(replay_sha256);
