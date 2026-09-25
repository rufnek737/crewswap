-- Apply to D1 BEFORE deploying the security Worker. Existing tables are untouched.
CREATE TABLE IF NOT EXISTS verification_challenges (email TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crew_grades (name TEXT PRIMARY KEY, data TEXT NOT NULL);
