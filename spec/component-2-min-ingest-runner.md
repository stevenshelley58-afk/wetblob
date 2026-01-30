# Component 2: Minimal Ingest Runner

Status: SPEC
Scope: End-to-end collector -> items -> dashboard list with ONE collector (http_snapshot)

## Goals

Build a minimal, correct ingest pipeline that proves:
1. Collector fetches content and stores items + blobs
2. Scheduled runner creates runs, executes collectors, writes logs
3. Dedupe works via canonical_uri and content_sha256
4. Basic CLI to list ingested items

## Non-Goals (explicitly out of scope)

- Agent generation / AI processing
- Dashboard UI (beyond basic list command)
- Multiple collectors
- Webhook triggers
- Real-time streaming
- Complex scheduling (just cron-able script)

## Deliverables

### 1. Collector: collect.http_snapshot

Fetches a fixed list of URLs from config and stores HTTP responses.

**Data Contract per fetched page:**

| Field | Value |
|-------|-------|
| items.type | "intel.webpage" |
| items.source_type | "collector" |
| items.source_id | "http_snapshot" |
| items.external_ref | original_url (as provided in config) |
| items.canonical_uri | normalized_url (lowercase, no fragments, sorted query params) |
| items.observed_at | fetch_time (ISO timestamp) |
| items.content_sha256 | sha256(normalized_text) for dedupe |
| Payload | HTML bytes stored as blob with mime_type = "text/html" |

**URL Normalization rules (canonical_uri):**
1. Lowercase scheme and host
2. Remove default ports (:80 for http, :443 for https)
3. Remove fragment (#...)
4. Sort query parameters alphabetically
5. Remove tracking params (utm_source, utm_medium, utm_campaign, fbclid, gclid)

**Text Normalization (for content_sha256):**
1. Extract text content from HTML (strip tags)
2. Normalize whitespace (collapse multiple spaces/newlines to single space)
3. Trim leading/trailing whitespace
4. Lowercase
5. Compute sha256 of resulting text

### 2. Scheduled Entrypoint: scripts/run-collector.ts

A single cron-able script that:
1. Creates a run row with kind="cli", tool_name="collect.http_snapshot"
2. Loads collector config (list of URLs)
3. Executes the collector for each URL
4. Writes run outputs (item_ids produced)
5. Writes run logs (info, warn, error levels)
6. Finishes run with status="succeeded" or "failed"

**Idempotency:** Uses idempotency_key = "http_snapshot:{date}:{hour}" to prevent duplicate runs within same hour.

### 3. List Command: pnpm lake:list

Prints latest N items by type/time:

```
ITEM_ID                TYPE           CANONICAL_URI                    OBSERVED_AT          EXCERPT
01hq8...abc123         intel.webpage  https://example.com/page         2025-01-30T10:00:00Z This is the first 80 chars of text...
01hq8...def456         intel.webpage  https://example.com/other        2025-01-30T10:00:01Z Another excerpt here...
```

Columns: item_id (short), type, canonical_uri, observed_at, excerpt (first 80 chars of text_content or "[blob]" for blob items)

## Dedupe Rules (Mandatory)

When inserting a new item:
1. Compute canonical_uri and content_sha256
2. Query for existing items with same canonical_uri OR same content_sha256
3. If found:
   - Insert new item anyway (preserves history)
   - Create edge: existing_item -[rel="supersedes"]-> new_item
   - Log: "Found existing item {item_id} with same canonical_uri/content_sha256, linked via supersedes edge"
4. If not found:
   - Insert new item normally
   - Log: "Created new item {item_id}"

## Tests (3 new tests on top of existing 12)

### Test 1: Idempotent Ingestion
Running the same collector input twice does not create duplicate runs (idempotency_key prevents it). If idempotency window passes, new run creates new items with supersedes edges.

### Test 2: Dedupe Behavior
Same canonical_uri or same content_sha256 creates supersedes edge linking old to new item.

### Test 3: Runs and Logs Exist
Each ingest run writes at least:
- 1 run row with correct kind, tool_name, status
- Run output references to produced item_ids
- At least one log line (info level minimum)

## File Structure

```
packages/
  lake-db/
    src/
      collect/
        http-snapshot.ts      # Collector implementation
        normalize.ts          # URL and text normalization
  lake-cli/
    package.json              # New package for CLI commands
    src/
      commands/
        list.ts               # lake:list implementation
      config.ts               # Collector config loader
      index.ts                # CLI entrypoint
    scripts/
      run-collector.ts        # Cron-able runner script
spec/
  component-2-min-ingest-runner.md  # This spec
```

## Acceptance Checklist

- [ ] http_snapshot collector fetches URLs and stores items with correct fields
- [ ] URL normalization works (lowercase, no fragments, sorted params)
- [ ] Text normalization and content_sha256 computation works
- [ ] Dedupe creates supersedes edges when canonical_uri or content_sha256 matches
- [ ] run-collector.ts script creates runs, outputs, logs
- [ ] Idempotency key prevents duplicate runs within same window
- [ ] pnpm lake:list prints latest items with all columns
- [ ] All 3 new tests pass
- [ ] Total test count = 15 (12 existing + 3 new)

## Runner Contract (Explicit)

### Run Statuses

| Status | Description |
|--------|-------------|
| `STARTED` | Run has been created and collector execution is in progress |
| `SUCCEEDED` | Run completed with at least 1 output item created and no hard fatal errors |
| `FAILED` | Run completed with no output items OR a hard fatal error occurred |

### Run Lifecycle Rules

1. **Run Creation**: A run is created once per collector execution attempt, not per URL
2. **Partial Success**: A run can be partially successful (some URLs succeed, some fail)
3. **Success Criteria**: Run succeeds if at least 1 output item is created AND no hard fatal error occurred
4. **Failure Criteria**: Run fails if zero output items created OR a hard fatal error occurred
5. **Logging Requirement**: Every URL attempt produces a log row (success or failure) with appropriate level

### Exit Codes

| Exit Code | Condition |
|-----------|-----------|
| `0` | All collectors succeeded |
| `1` | Any collector failed |

### Idempotency Behavior

When `startRun` is called with an idempotency key:

1. **Duplicate Detection**: If the call fails due to a unique constraint violation on the idempotency key:
   - Treat the execution as success
   - Print message: `skipped (idempotent)`
   - Exit with code `0`

2. **Fail-Fast Override**: If the `--fail-fast` flag is provided:
   - Exit with code `1` when idempotency conflict occurs
   - Print message: `skipped (idempotent) -- fail-fast enabled`
