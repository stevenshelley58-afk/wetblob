import { Db } from '../db.js';
import { ulid } from '../ulid.js';
import { Run } from '../types.js';

export interface StartRunInput {
  collectorType: string;
  collectorName: string;
  normalizationVersion: string;
  idempotencyKey: string;
  configSnapshot: Record<string, unknown>;
  db: Db;
}

export interface StartRunResult {
  runId: string;
  status: string;
  createdAt: Date;
}

export interface IdempotencyConflictError {
  type: 'idempotency_conflict';
  existingRunId: string;
  message: string;
}

/**
 * Start a new collector run.
 * Creates a run row with status 'running'.
 * Throws if an idempotency conflict is detected (same idempotency key already exists).
 */
export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const { collectorType, collectorName, normalizationVersion, idempotencyKey, configSnapshot, db } = input;

  // Check for existing run with same idempotency key
  const existingRun = await db.oneOrNone<Run>(
    `SELECT run_id, status, started_at FROM runs WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  if (existingRun) {
    const error = new Error(
      `Idempotency conflict: run ${existingRun.run_id} already exists with this idempotency key`
    ) as Error & IdempotencyConflictError;
    error.type = 'idempotency_conflict';
    error.existingRunId = existingRun.run_id;
    throw error;
  }

  const runId = ulid();
  const now = new Date();

  await db.none(
    `INSERT INTO runs(
       run_id, kind, actor, tool_name, tool_version, 
       idempotency_key, normalization_version, collector_version, 
       status, metrics, started_at
     )
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      runId,
      'cli',                          /* kind */
      null,                           /* actor */
      collectorName,                  /* tool_name */
      '1.0.0',                        /* tool_version */
      idempotencyKey,
      normalizationVersion,
      collectorType,                  /* collector_version stores the collector type */
      'running',
      JSON.stringify({ configSnapshot }),
      now
    ]
  );

  return {
    runId,
    status: 'running',
    createdAt: now
  };
}

export interface AppendRunLogInput {
  runId: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  meta?: {
    url?: string;
    status?: number;
    bytes?: number;
    [key: string]: unknown;
  };
  db: Db;
}

/**
 * Append a log entry to the run_logs table.
 */
export async function appendRunLog(input: AppendRunLogInput): Promise<void> {
  const { runId, level, message, meta, db } = input;

  const logId = ulid();

  await db.none(
    `INSERT INTO run_logs(log_id, run_id, level, message, data)
     VALUES($1, $2, $3, $4, $5)`,
    [logId, runId, level, message, JSON.stringify(meta ?? {})]
  );
}

export interface RunStats {
  urlsAttempted: number;
  urlsSucceeded: number;
  itemsCreated: number;
  bytesDownloaded: number;
}

export interface FinishRunInput {
  runId: string;
  status: 'succeeded' | 'failed';
  stats: RunStats;
  errorSummary?: string;
  db: Db;
}

/**
 * Finish a run by updating its status and recording stats.
 */
export async function finishRun(input: FinishRunInput): Promise<void> {
  const { runId, status, stats, errorSummary, db } = input;

  await db.none(
    `UPDATE runs
     SET status = $2,
         finished_at = now(),
         error = $3,
         metrics = jsonb_set(
           jsonb_set(metrics, '{stats}', $4::jsonb),
           '{finished}',
           'true'::jsonb
         )
     WHERE run_id = $1`,
    [runId, status, errorSummary ?? null, JSON.stringify(stats)]
  );
}
