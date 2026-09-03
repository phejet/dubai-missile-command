CREATE TABLE operator_deletions (
  job_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('run', 'install', 'reservation')),
  reference_hash TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('locking', 'objects', 'rows', 'replays', 'verifying', 'complete', 'blocked', 'aborted')),
  blocked_stage TEXT CHECK (blocked_stage IS NULL OR blocked_stage IN ('locking', 'objects', 'rows', 'replays', 'verifying')),
  target_counts_json TEXT NOT NULL,
  object_manifest_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX idx_operator_deletions_state
  ON operator_deletions(state, updated_at DESC);

CREATE TABLE capture_write_reservations (
  request_id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('session', 'report')),
  owner_id TEXT NOT NULL,
  install_id TEXT NOT NULL,
  run_id TEXT,
  request_sha256 TEXT NOT NULL,
  diagnostic_r2_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_capture_write_reservations_install
  ON capture_write_reservations(install_id);

CREATE INDEX idx_capture_write_reservations_run
  ON capture_write_reservations(run_id);

CREATE TABLE replay_write_reservations (
  request_id TEXT PRIMARY KEY,
  replay_sha256 TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('session', 'report')),
  owner_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_replay_write_reservations_sha
  ON replay_write_reservations(replay_sha256);

CREATE TABLE replay_deletion_locks (
  replay_sha256 TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES operator_deletions(job_id),
  acquired_at INTEGER NOT NULL
);

CREATE INDEX idx_replay_deletion_locks_job
  ON replay_deletion_locks(job_id);

CREATE TABLE operator_deletion_scope_locks (
  scope TEXT NOT NULL CHECK (scope IN ('run', 'install')),
  reference TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES operator_deletions(job_id),
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (scope, reference)
);

CREATE INDEX idx_operator_deletion_scope_locks_job
  ON operator_deletion_scope_locks(job_id);

CREATE TABLE capture_deletion_tombstones (
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('session', 'report')),
  owner_id_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_kind, owner_id_hash)
);

CREATE INDEX idx_capture_deletion_tombstones_expiry
  ON capture_deletion_tombstones(expires_at);
