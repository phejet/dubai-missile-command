CREATE TABLE app_attest_credentials (
  key_id_hash TEXT PRIMARY KEY,
  public_key BLOB NOT NULL,
  apple_environment TEXT NOT NULL CHECK (apple_environment IN ('development', 'production')),
  assertion_counter INTEGER NOT NULL DEFAULT 0 CHECK (assertion_counter >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX idx_app_attest_credentials_status
  ON app_attest_credentials(status, last_seen_at DESC);

ALTER TABLE sessions ADD COLUMN sha256 TEXT;
ALTER TABLE sessions ADD COLUMN submitter_key_id_hash TEXT
  REFERENCES app_attest_credentials(key_id_hash);
CREATE INDEX idx_sessions_submitter
  ON sessions(submitter_key_id_hash, received_at DESC);

ALTER TABLE diagnostic_reports ADD COLUMN submitter_key_id_hash TEXT
  REFERENCES app_attest_credentials(key_id_hash);
CREATE INDEX idx_reports_submitter
  ON diagnostic_reports(submitter_key_id_hash, received_at DESC);
