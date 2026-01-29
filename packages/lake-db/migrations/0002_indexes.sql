CREATE INDEX IF NOT EXISTS idx_items_type_created ON items(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_tags ON items USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_items_canonical_uri ON items(canonical_uri);
CREATE INDEX IF NOT EXISTS idx_items_content_sha256 ON items(content_sha256);

CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_item_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_item_id);
CREATE INDEX IF NOT EXISTS idx_edges_rel ON edges(rel);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_idempotency_key
  ON runs(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_lease ON tasks(locked_until);
