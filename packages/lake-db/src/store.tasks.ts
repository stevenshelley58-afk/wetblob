import { Db } from './db.js';
import { ulid } from './ulid.js';
import { Task } from './types.js';

export interface EnqueueTaskInput {
  type: string;
  payload: Record<string, unknown>;
  dueAt?: Date;
  priority?: number;
  runId?: string;
  maxAttempts?: number;
}

export async function enqueueTask(db: Db, input: EnqueueTaskInput): Promise<Task> {
  const taskId = ulid();
  
  const row = await db.one(
    `INSERT INTO tasks(task_id, run_id, type, payload, due_at, priority, max_attempts)
     VALUES($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      taskId,
      input.runId ?? null,
      input.type,
      JSON.stringify(input.payload),
      input.dueAt ?? new Date(),
      input.priority ?? 0,
      input.maxAttempts ?? 10
    ]
  );
  
  return row;
}

export interface LeaseResult {
  task: Task | null;
}

export async function leaseNextTask(
  db: Db,
  workerId: string,
  leaseMs: number
): Promise<Task | null> {
  // Atomic lease using FOR UPDATE SKIP LOCKED - must use a transaction
  return db.tx(async tx => {
    const row = await tx.oneOrNone(
      `WITH next AS (
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
      RETURNING *`,
      [workerId, leaseMs]
    );
    return row;
  });
}

export async function markTaskRunning(db: Db, taskId: string): Promise<void> {
  await db.none(
    `UPDATE tasks SET status = 'running', updated_at = now() WHERE task_id = $1`,
    [taskId]
  );
}

export async function markTaskSucceeded(db: Db, taskId: string): Promise<void> {
  await db.none(
    `UPDATE tasks SET status = 'succeeded', updated_at = now() WHERE task_id = $1`,
    [taskId]
  );
}

export async function markTaskFailed(
  db: Db,
  taskId: string,
  error: string
): Promise<void> {
  await db.none(
    `UPDATE tasks
     SET status = CASE
       WHEN attempts + 1 >= max_attempts THEN 'dead'
       ELSE 'queued'
     END,
     attempts = attempts + 1,
     last_error = $2,
     locked_until = NULL,
     locked_by = NULL,
     updated_at = now()
     WHERE task_id = $1`,
    [taskId, error]
  );
}

export async function getTask(db: Db, taskId: string): Promise<Task | null> {
  return db.oneOrNone(`SELECT * FROM tasks WHERE task_id = $1`, [taskId]);
}
