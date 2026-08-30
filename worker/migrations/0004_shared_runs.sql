CREATE TABLE shared_runs (
  share_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES sessions(run_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_shared_runs_created
  ON shared_runs(created_at DESC);
