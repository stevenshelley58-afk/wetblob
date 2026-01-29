CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable bytes
CREATE TABLE blobs (
  blob_id TEXT PRIMARY KEY,                -- "sha256:<hex>"
  size_bytes BIGINT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semantic records pointing to either inline text or a blob
CREATE TABLE items (
  item_id TEXT PRIMARY KEY,                -- ULID
  type TEXT NOT NULL,                      -- "web.page.raw", "pdf.text", "note", etc
  title TEXT,
  source_type TEXT NOT NULL,               -- "collector", "agent", "manual", "webhook"
  source_id TEXT NOT NULL,                 -- "collect.web", "agent.trend", etc
  external_ref TEXT,                       -- url, message-id, file-id
  canonical_uri TEXT,                      -- normalized URL when relevant
  content_sha256 TEXT,                     -- hash of normalized text when relevant
  observed_at TIMESTAMPTZ,                 -- when the thing happened, not when stored
  tags TEXT[] NOT NULL DEFAULT '{}',
  sensitivity TEXT NOT NULL DEFAULT 'private', -- private|public|secret|restricted
  blob_id TEXT REFERENCES blobs(blob_id),
  text_content TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT items_one_payload CHECK (
    (blob_id IS NOT NULL AND text_content IS NULL) OR
    (blob_id IS NULL AND text_content IS NOT NULL)
  )
);

-- Graph layer
CREATE TABLE edges (
  edge_id TEXT PRIMARY KEY,                -- ULID
  from_item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  to_item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  rel TEXT NOT NULL,                       -- derived_from, mentions, supersedes, same_as, etc
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every execution context
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,                 -- ULID
  parent_run_id TEXT REFERENCES runs(run_id),
  kind TEXT NOT NULL,                      -- cli|agent|workflow|trigger
  actor TEXT,                              -- "steve", "agent:trend", "system"
  tool_name TEXT,
  tool_version TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running|succeeded|failed|canceled
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE run_inputs (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, item_id)
);

CREATE TABLE run_outputs (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  PRIMARY KEY (run_id, item_id)
);

CREATE TABLE run_logs (
  log_id TEXT PRIMARY KEY,                 -- ULID
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',      -- debug|info|warn|error
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task queue
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,                -- ULID
  run_id TEXT REFERENCES runs(run_id),
  type TEXT NOT NULL,                      -- "derive.clean", "derive.embed", "collect.web.fetch"
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|leased|running|succeeded|failed|dead
  priority INT NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 10,
  locked_until TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
