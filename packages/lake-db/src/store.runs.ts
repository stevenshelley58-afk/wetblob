import { Db } from './db.js';
import { ulid } from './ulid.js';
import { Run } from './types.js';

export interface CreateRunInput {
  kind: 'cli' | 'agent' | 'workflow' | 'trigger';
  actor?: string;
  toolName?: string;
  toolVersion?: string;
  idempotencyKey?: string;
  parentRunId?: string;
  normalizationVersion?: string;
  collectorVersion?: string;
}

export async function createRun(db: Db, input: CreateRunInput): Promise<Run> {
  const runId = ulid();
  
  const row = await db.one(
    `INSERT INTO runs(run_id, parent_run_id, kind, actor, tool_name, tool_version, idempotency_key, normalization_version, collector_version)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      runId,
      input.parentRunId ?? null,
      input.kind,
      input.actor ?? null,
      input.toolName ?? null,
      input.toolVersion ?? null,
      input.idempotencyKey ?? null,
      input.normalizationVersion ?? 'v1',
      input.collectorVersion ?? null
    ]
  );
  
  return row;
}

export async function addRunInput(db: Db, runId: string, itemId: string): Promise<void> {
  await db.none(
    `INSERT INTO run_inputs(run_id, item_id) VALUES($1, $2)`,
    [runId, itemId]
  );
}

export async function addRunOutput(db: Db, runId: string, itemId: string): Promise<void> {
  await db.none(
    `INSERT INTO run_outputs(run_id, item_id) VALUES($1, $2)`,
    [runId, itemId]
  );
}

export async function appendRunLog(
  db: Db,
  runId: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  const logId = ulid();
  await db.none(
    `INSERT INTO run_logs(log_id, run_id, level, message, data)
     VALUES($1, $2, $3, $4, $5)`,
    [logId, runId, level, message, JSON.stringify(data ?? {})]
  );
}

export async function finishRun(
  db: Db,
  runId: string,
  status: 'succeeded' | 'failed' | 'canceled',
  error?: string
): Promise<void> {
  await db.none(
    `UPDATE runs
     SET status = $2, finished_at = now(), error = $3
     WHERE run_id = $1`,
    [runId, status, error ?? null]
  );
}

export async function getRun(db: Db, runId: string): Promise<Run | null> {
  return db.oneOrNone(`SELECT * FROM runs WHERE run_id = $1`, [runId]);
}
