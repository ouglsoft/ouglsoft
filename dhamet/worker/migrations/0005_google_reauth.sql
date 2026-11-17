ALTER TABLE oauth_states ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login';
ALTER TABLE oauth_states ADD COLUMN user_id TEXT;
ALTER TABLE oauth_states ADD COLUMN return_path TEXT;
