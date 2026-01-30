# Wetblob Build Discipline

## North Star
Ship in small verified increments. No speculative architecture. No skipping tests.

## Workflow (always)
1) Edit only within current component scope.
2) Run build + tests immediately.
3) If failing, fix before moving on.
4) Keep a single spec as source of truth.

## Scope right now
Component 1 only: Lake Storage (db schema + migrations + storage APIs + tests).
NO gateway. NO CLI. NO skills runtime. NO workflow engine.

## Non-negotiable invariants
- blob_id is sha256 of bytes; immutable; never overwritten.
- items must have exactly one payload: blob_id OR text_content.
- edges must reference existing items (FK enforced).
- tasks leasing must be atomic with FOR UPDATE SKIP LOCKED.
- DB changes ONLY via new migration files (never edit old migrations).
