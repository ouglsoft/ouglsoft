CREATE TABLE IF NOT EXISTS training_records (
  round_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('pvp', 'pvc')),
  ended_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_training_records_export
  ON training_records(ended_at DESC, round_id DESC);
