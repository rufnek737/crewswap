-- Apply to D1 BEFORE deploying the friends Worker. Existing tables are untouched.
CREATE TABLE IF NOT EXISTS friends (email TEXT PRIMARY KEY, data TEXT NOT NULL);
