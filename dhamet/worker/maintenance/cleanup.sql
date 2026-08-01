DELETE FROM sessions
WHERE token_hash IN (
  SELECT token_hash
  FROM sessions
  WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
  ORDER BY expires_at
  LIMIT 500
);

DELETE FROM oauth_states
WHERE state IN (
  SELECT state
  FROM oauth_states
  WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
     OR (used_at IS NOT NULL AND used_at <= CAST(strftime('%s', 'now') AS INTEGER) - 86400)
  ORDER BY expires_at
  LIMIT 500
);

DELETE FROM password_reset_tokens
WHERE token_hash IN (
  SELECT token_hash
  FROM password_reset_tokens
  WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER)
     OR (used_at IS NOT NULL AND used_at <= CAST(strftime('%s', 'now') AS INTEGER) - 86400)
  ORDER BY expires_at
  LIMIT 500
);

DELETE FROM users
WHERE id IN (
  SELECT u.id
  FROM users AS u
  WHERE u.kind = 'guest'
    AND u.last_active_at <= (CAST(strftime('%s', 'now') AS INTEGER) - 2678400) * 1000
    AND NOT EXISTS (
      SELECT 1
      FROM sessions AS s
      WHERE s.user_id = u.id
    )
  ORDER BY u.last_active_at
  LIMIT 200
);
