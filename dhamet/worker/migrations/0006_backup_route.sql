CREATE TABLE IF NOT EXISTS backup_route_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'cloudflare',
  enabled INTEGER NOT NULL DEFAULT 0,
  backup_url TEXT NOT NULL DEFAULT 'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  threshold REAL NOT NULL DEFAULT 90,
  observed_percent REAL NOT NULL DEFAULT 0,
  metric_key TEXT NOT NULL DEFAULT '',
  generation INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  valid_until INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}'
);

INSERT OR IGNORE INTO backup_route_control (
  id, mode, enabled, backup_url, reason, source, threshold, observed_percent,
  metric_key, generation, updated_at, valid_until, reset_at, metrics_json
) VALUES (
  1, 'cloudflare', 0,
  'https://dhamet2.ouglsoft.com/pages/loby.html?emergency=1',
  'initial', 'migration', 90, 0, '', 0, 0, 0, 0, '{}'
);
