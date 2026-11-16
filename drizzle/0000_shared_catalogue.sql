CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  document TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE offer_photos (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  content TEXT NOT NULL
);
