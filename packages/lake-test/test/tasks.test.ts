import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, migrate, enqueueTask, leaseNextTask, markTaskFailed, getTask } from '@wetblob/lake-db';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Tasks', () => {
  const db = createDb();
  const migrationsDir = join(__dirname, '../../lake-db/migrations');

  beforeAll(async () => {
    await migrate(db, migrationsDir);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  it('leasing is exclusive: two concurrent leases return at most one task', async () => {
    // Create a task
    await enqueueTask(db, {
      type: 'test.task',
      payload: { test: true }
    });

    // Two concurrent lease attempts
    const [lease1, lease2] = await Promise.all([
      leaseNextTask(db, 'worker-1', 60000),
      leaseNextTask(db, 'worker-2', 60000)
    ]);

    // At most one should get the task
    const gotTaskCount = [lease1, lease2].filter(l => l !== null).length;
    expect(gotTaskCount).toBeLessThanOrEqual(1);
  });

  it('retries increment attempts and respect max_attempts (dead at limit)', async () => {
    const task = await enqueueTask(db, {
      type: 'test.task',
      payload: { test: true },
      maxAttempts: 3
    });

    // First lease and fail
    const lease1 = await leaseNextTask(db, 'worker-1', 1000);
    expect(lease1).not.toBeNull();
    await markTaskFailed(db, lease1!.task_id, 'Error 1');

    let t = await getTask(db, task.task_id);
    expect(t!.attempts).toBe(1);
    expect(t!.status).toBe('queued'); // Should be back to queued

    // Second lease and fail
    const lease2 = await leaseNextTask(db, 'worker-1', 1000);
    expect(lease2).not.toBeNull();
    await markTaskFailed(db, lease2!.task_id, 'Error 2');

    t = await getTask(db, task.task_id);
    expect(t!.attempts).toBe(2);
    expect(t!.status).toBe('queued');

    // Third lease and fail - should go to dead
    const lease3 = await leaseNextTask(db, 'worker-1', 1000);
    expect(lease3).not.toBeNull();
    await markTaskFailed(db, lease3!.task_id, 'Error 3');

    t = await getTask(db, task.task_id);
    expect(t!.attempts).toBe(3);
    expect(t!.status).toBe('dead'); // Now it's dead
  });

  it('task respects priority ordering', async () => {
    // Create tasks with different priorities
    const lowPriority = await enqueueTask(db, {
      type: 'test.task',
      payload: { priority: 'low' },
      priority: 0
    });

    const highPriority = await enqueueTask(db, {
      type: 'test.task',
      payload: { priority: 'high' },
      priority: 10
    });

    // Should get high priority first
    const lease = await leaseNextTask(db, 'worker-1', 60000);
    expect(lease).not.toBeNull();
    expect(lease!.task_id).toBe(highPriority.task_id);
  });

  it('task respects due_at ordering', async () => {
    const futureDate = new Date(Date.now() + 60000);
    const pastDate = new Date(Date.now() - 60000);

    const futureTask = await enqueueTask(db, {
      type: 'test.task',
      payload: { when: 'future' },
      dueAt: futureDate
    });

    const pastTask = await enqueueTask(db, {
      type: 'test.task',
      payload: { when: 'past' },
      dueAt: pastDate
    });

    // Should get past task first
    const lease = await leaseNextTask(db, 'worker-1', 60000);
    expect(lease).not.toBeNull();
    expect(lease!.task_id).toBe(pastTask.task_id);
  });
});
