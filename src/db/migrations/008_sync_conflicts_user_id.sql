-- 008: Add user_id to sync_conflicts for ownership tracking
-- Needed so conflict resolve can verify the caller is the conflict owner.
ALTER TABLE sync_conflicts ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_user ON sync_conflicts(user_id);
