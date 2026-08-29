ALTER TABLE app_attest_credentials ADD COLUMN apple_app_id TEXT;

ALTER TABLE sessions ADD COLUMN app_flavor TEXT NOT NULL DEFAULT 'unknown'
  CHECK (app_flavor IN ('dev', 'staging', 'production', 'unknown'));
ALTER TABLE sessions ADD COLUMN apple_bundle_id TEXT;
ALTER TABLE sessions ADD COLUMN apple_environment TEXT
  CHECK (apple_environment IS NULL OR apple_environment IN ('development', 'production'));

ALTER TABLE diagnostic_reports ADD COLUMN app_flavor TEXT NOT NULL DEFAULT 'unknown'
  CHECK (app_flavor IN ('dev', 'staging', 'production', 'unknown'));
ALTER TABLE diagnostic_reports ADD COLUMN apple_bundle_id TEXT;
ALTER TABLE diagnostic_reports ADD COLUMN apple_environment TEXT
  CHECK (apple_environment IS NULL OR apple_environment IN ('development', 'production'));

CREATE INDEX idx_sessions_flavor_received
  ON sessions(app_flavor, received_at DESC);
CREATE INDEX idx_reports_flavor_received
  ON diagnostic_reports(app_flavor, received_at DESC);
