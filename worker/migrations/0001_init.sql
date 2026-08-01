CREATE TABLE captures (
  capture_id TEXT PRIMARY KEY,
  run_id TEXT,
  install_id TEXT NOT NULL,
  install_ephemeral INTEGER NOT NULL DEFAULT 0,
  boot_id TEXT NOT NULL,
  build TEXT NOT NULL,
  platform TEXT NOT NULL,
  input_class TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  app_screen TEXT NOT NULL,
  replay_source TEXT NOT NULL,
  partial INTEGER NOT NULL,
  captured_through_tick INTEGER,
  note TEXT,
  replay_sha256 TEXT,
  replay_complete INTEGER NOT NULL,
  replay_omitted_reason TEXT,
  events_count INTEGER NOT NULL,
  events_truncated INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  raw_bytes INTEGER NOT NULL,
  stored_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL
);

CREATE INDEX idx_captures_install ON captures(install_id, received_at DESC);
CREATE INDEX idx_captures_run ON captures(run_id);
CREATE INDEX idx_captures_received ON captures(received_at DESC);

CREATE TABLE sessions (
  run_id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
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
  replay_size INTEGER,
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
