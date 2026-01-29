# Lake Storage v1 Spec (Component 1 only)

Status: CANONICAL
Scope: Storage only (DB schema + storage modules + tests). No Gateway, CLI, Skills, or Workflow runtime.

## Goals

Build a minimal, correct "Lake Storage" layer that supports:
- Immutable content-addressed blobs
- Semantic items (text or blob)
- Graph edges between items
- Run tracking (inputs, outputs, logs)
- Concurrency-safe task queue (lease with SKIP LOCKED)

All correctness enforced by DB invariants + tests.

## Non-Goals (explicitly out of scope)

- HTTP API, WebSocket control plane
- CLI commands
- Embeddings/vector search
- Skills system or workflow approvals
- Collectors/janitors
- Auth, multi-tenant, encryption-at-rest

## Repo scaffold (must exist)

Tree (minimum for Storage v1):

```text
.
├─ README.md
├─ .env.example
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ package.json
├─ tsconfig.base.json
├─ packages/
│  ├─ lake-db/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ src/
│  │  │  ├─ db.ts
│  │  │  ├─ migrate.ts
│  │  │  ├─ migrate.cli.ts
│  │  │  ├─ ulid.ts
│  │  │  ├─ sha256.ts
│  │  │  ├─ types.ts
│  │  │  ├─ store.blob.ts
│  │  │  ├─ store.items.ts
│  │  │  ├─ store.edges.ts
│  │  │  ├─ store.runs.ts
│  │  │  ├─ store.tasks.ts
│  │  │  └─ index.ts
│  │  └─ migrations/
│  │     ├─ 0001_init.sql
│  │     └─ 0002_indexes.sql
│  └─ lake-test/
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ test/
│        ├─ blobs.test.ts
│        ├─ items.test.ts
│        ├─ edges.test.ts
│        └─ tasks.test.ts
```

### Local infra (Postgres + MinIO)

docker-compose.yml:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: lake
      POSTGRES_PASSWORD: lake
      POSTGRES_DB: lake
    ports:
      - "5432:5432"
    volumes:
      - lake_pg:/var/lib/postgresql/data

  minio:
    image: minio/minio:RELEASE.2025-01-20T00-00-00Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio123456
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - lake_minio:/data

volumes:
  lake_pg:
  lake_minio:
```

.env.example:
```
DATABASE_URL=postgresql://lake:lake@localhost:5432/lake

S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio123456
S3_BUCKET=lake
S3_FORCE_PATH_STYLE=true
```

Note: In Storage v1, MinIO is provisioned but object upload is optional. Truth is metadata + invariants.

## Database schema

### packages/lake-db/migrations/0001_init.sql
```sql
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
```

### packages/lake-db/migrations/0002_indexes.sql
```sql
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
```

## Migration runner

packages/lake-db/src/migrate.ts:
- Reads migrations folder
- Applies in lexical order
- Records in schema_migrations
- Never re-applies applied versions

## Storage modules (thin functions)

### store.blob.ts
- putBlob({bytes, mimeType?}) computes sha256, returns blobId, inserts metadata row if new.
- Never overwrites.

### store.items.ts
- createItem(...) enforces exactly one payload (blob_id or text_content) by DB constraint
- touchUpdatedAt(itemId)
- findItem(itemId)

### store.edges.ts
- createEdge(from, to, rel, meta)
- listEdgesFrom(itemId, rel?)
- listEdgesTo(itemId, rel?)

### store.runs.ts
- createRun({kind, actor, toolName, toolVersion, idempotencyKey})
- addRunInput(runId, itemId)
- addRunOutput(runId, itemId)
- appendRunLog(runId, level, message, data)
- finishRun(runId, status, error?)

### store.tasks.ts
- enqueueTask({type, payload, dueAt, priority, runId})
- leaseNextTask({workerId, leaseMs}) MUST be atomic, FOR UPDATE SKIP LOCKED
- markTaskSucceeded(taskId)
- markTaskFailed(taskId, error) increments attempts, moves to dead at max_attempts

Lease SQL (atomic requirement):
```sql
WITH next AS (
  SELECT task_id
  FROM tasks
  WHERE status = 'queued'
    AND due_at <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY priority DESC, due_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE tasks
SET status = 'leased',
    locked_until = now() + ($2::int || ' milliseconds')::interval,
    locked_by = $1,
    updated_at = now()
WHERE task_id IN (SELECT task_id FROM next)
RETURNING *;
```

## Workspace config

Root package.json scripts:
- dev:infra
- dev:down
- db:migrate
- test

packages/lake-db is TS build + vitest.

## Tests (must pass before moving to Component 2)

Use real Postgres via docker compose.

Minimum tests:

### Blobs:
- putBlob twice same bytes => same blobId, second inserted=false

### Items:
- create item with both blob_id and text_content fails (check constraint)
- create item with neither fails (check constraint)

### Edges:
- cannot create edge referencing missing items (FK)

### Tasks:
- leasing is exclusive: two concurrent leases return at most one task
- retries increment attempts and respect max_attempts (dead at limit)

## Acceptance criteria

All true:
- pnpm dev:infra
- pnpm db:migrate creates schema and records migrations
- pnpm test is green
- Invariants enforced by DB:
  - blob ids immutable/unique
  - items have exactly one payload
  - edges cannot reference missing items
  - task leasing atomic/concurrency-safe
