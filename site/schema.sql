CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  scenario TEXT NOT NULL,
  batch_size TEXT NOT NULL,
  price_interest TEXT NOT NULL,
  need TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delete_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist(created_at);
CREATE TABLE IF NOT EXISTS limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

