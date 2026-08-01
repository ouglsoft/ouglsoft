CREATE INDEX IF NOT EXISTS idx_password_reset_exp
  ON password_reset_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_users_kind_last_active
  ON users(kind, last_active_at);
