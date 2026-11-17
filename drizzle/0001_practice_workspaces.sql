CREATE TABLE IF NOT EXISTS practice_workspaces (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  document TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS practice_workspaces_expiry ON practice_workspaces (expires_at);
