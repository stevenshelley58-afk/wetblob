import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrate, enqueueTask, leaseNextTask, markTaskFailed, getTask } from '@wetblob/lake-db';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate unique test prefix to isolate tests
const testId = Date.now().toString(36);

describe('Tasks', () => {
  const db = createDb();
  const migrationsDir = join(__dirname, '../../lake-db/migrations');

  beforeAll(async () => {
    await migrate(db, migrationsDir);
    // Clean up any leftover tasks from previous test runs
    await db.none(`DELETE FROM tasks WHERE type LIKE 'test.%'`);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  it('leasing is exclusive: two concurrent leases return at most one task', async () => {
    // Create a dedicated db connections for each worker to test true concurrency
    const db1 = createDb();
    const db2 = createDb();
    
    try {
      // Create a task
      await enqueueTask(db, {
        type: `test.lease.${testId}`,
        payload: { test: true }
      });

      // Two concurrent lease attempts on separate connections
      const [lease1, lease2] = await Promise.all([
        leaseNextTask(db1, 'worker-1', 60000),
        leaseNextTask(db2, 'worker-2', 60000)
      ]);

      // At most one should get the task
      const gotTaskCount = [lease1, lease2].filter(l => l !== null).length;
      expect(gotTaskCount).toBeLessThanOrEqual(1);
    } finally {
      await db1.$pool.end();
      await db2.$pool.end();
    }
  });

  it('retries increment attempts and respect max_attempts (dead at limit)', async () => {
    const taskType = `test.retry.${testId}.${Math.random()}`;
    const task = await enqueueTask(db, {
      type: taskType,
      payload: { test: true },
      maxAttempts: 3
    });

    // First lease and fail
    const lease1 = await leaseNextTask(db, 'worker-1', 1000);
    expect(lease1).not.toBeNull();
    expect(lease1!.task_id).toBe(task.task_id);
    await markTaskFailed(db, lease1!.task_id, 'Error 1');

    let t = await getTask(db, task.task_id);
    expect(t!.attempts).toBe(1);
    expect(t!.status).toBe('queued'); // Should be back to queued

    // Second lease and fail
    const lease2 = await leaseNextTask(db, 'worker-1', 1000);
    expect(lease2).not.toBeNull();
    expect(lease2!.task_id).toBe(task.task_id);
    await markTaskFailed(db, lease2!.task_id, 'Error 2');

    t = await getTask(db, task.task_id);
    expect(t!.attempts).toBe(2);
    expect(t!.status).toBe('queued');

    // Third lease and fail - should go to dead
    const lease3 = await leaseNextTask(db, 'worker-1', 1000);
    expect(lease3).not.toBeNull();
    expect(lease3!.task_id).toBe(task.task_id);
    await markTaskFailed(db, lease3!.task_id, 'Error 3');

    t = await getTask(db, task.task_id);
    expect(t!.attempts).toBe(3);
    expect(t!.status).toBe('dead'); // Now it's dead
  });

  it('task respects priority ordering', async () => {
    const taskType = `test.priority.${testId}.${Math.random()}`;
    
    // Create tasks with different priorities
    const lowPriority = await enqueueTask(db, {
      type: taskType,
      payload: { priority: 'low' },
      priority: 0
    });

    const highPriority = await enqueueTask(db, {
      type: taskType,
      payload: { priority: 'high' },
      priority: 10
    });

    // Should get high priority first
    const lease = await leaseNextTask(db, 'worker-1', 60000);
    expect(lease).not.toBeNull();
    expect(lease!.task_id).toBe(highPriority.task_id);
  });

  it('task respects due_at ordering', async () => {
    const taskType = `test.dueat.${testId}.${Math.random()}`;
    const futureDate = new Date(Date.now() + 60000);
    const pastDate = new Date(Date.now() - 60000);

    const futureTask = await enqueueTask(db, {
      type: taskType,
      payload: { when: 'future' },
      dueAt: futureDate
    });

    const pastTask = await enqueueTask(db, {
      type: taskType,
      payload: { when: 'past' },
      dueAt: pastDate
    });

    // Should get past task first
    const lease = await leaseNextTask(db, 'worker-1', 60000);
    expect(lease).not.toBeNull();
    expect(lease!.task_id).toBe(pastTask.task_id);
  });
});
