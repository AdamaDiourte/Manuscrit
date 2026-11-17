CREATE TABLE IF NOT EXISTS manuscript_objects (
  key text COLLATE "C" PRIMARY KEY,
  etag text NOT NULL,
  content bytea NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
