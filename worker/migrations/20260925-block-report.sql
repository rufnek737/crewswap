-- Apply to D1 BEFORE deploying the block/report Worker. Existing tables are untouched.
CREATE TABLE IF NOT EXISTS user_blocks (email TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_reports_at ON reports(created_at);
