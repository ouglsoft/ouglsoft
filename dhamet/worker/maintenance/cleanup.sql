-- Daily D1 housekeeping, run by .github/workflows/cleanup-dhamet-d1.yml ("in bounded batches").
-- Removes only rows that can no longer be used: expired sessions, and password-reset and
-- sign-in (OAuth) tokens that are expired or already used. At most 2000 rows per table per run,
-- so one run can never write more than a bounded number of rows; a backlog is cleared over the
-- following runs. It never touches `users`, and never touches the players' results (those live
-- in the Durable Object, not in D1). Times in these tables are Unix seconds.

DELETE FROM sessions
WHERE token_hash IN (
  SELECT token_hash FROM sessions
  WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
  ORDER BY expires_at
  LIMIT 2000
);

DELETE FROM password_reset_tokens
WHERE token_hash IN (
  SELECT token_hash FROM password_reset_tokens
  WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER) OR used_at IS NOT NULL
  ORDER BY expires_at
  LIMIT 2000
);

DELETE FROM oauth_states
WHERE state IN (
  SELECT state FROM oauth_states
  WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER) OR used_at IS NOT NULL
  ORDER BY expires_at
  LIMIT 2000
);
