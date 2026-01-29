# Project scope lock: Lake build

This repo is a staged build. Implement components in order and do not drift.

## Current component
Component 1: Lake Storage only.

## Hard rules
- Spec is law: spec/lake-storage.v1.md is the canonical requirements.
- No Gateway, CLI, Skills, or Workflow runtime until Component 1 tests are green.
- Never edit old migrations. Add a new migration for any DB change.
- Task leasing must be atomic using FOR UPDATE SKIP LOCKED (see spec).
- DB invariants must be enforced by constraints/FKs, not only application code.
- Every meaningful change must keep build + tests running.

## Definition of done for Component 1
- docker compose up works
- migrations apply cleanly
- pnpm test is green
- tests cover the minimum cases in the spec
