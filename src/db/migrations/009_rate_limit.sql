-- 009: Rate limiting table (atomic counter via D1 UPSERT)
CREATE TABLE IF NOT EXISTS rate_limit (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit(expires_at);
