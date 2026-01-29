---
name: lake-storage
description: Build Component 1 (Lake Storage) exactly to spec and keep tests green.
allowed_tools: ["Read","Write","Edit","Grep","Glob","Bash"]
---

Follow spec/lake-storage.v1.md exactly.

Do, in order:
1) Ensure repo scaffold matches the spec tree.
2) Add docker-compose.yml and .env.example exactly per spec.
3) Add migrations 0001_init.sql and 0002_indexes.sql exactly per spec.
4) Implement packages/lake-db modules (db, migrate, stores) as described.
5) Implement packages/lake-test tests and make them pass against real Postgres.
6) Run:
   - docker compose up -d
   - pnpm install (workspace)
   - pnpm db:migrate
   - pnpm test
7) Iterate until green.

Constraints:
- Do not implement any component beyond Storage v1.
- Do not add dependencies unless required by the spec.
- Do not change schema semantics without updating spec and adding a new migration.
