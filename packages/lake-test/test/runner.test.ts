import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createDb,
  migrate,
  startCollectorRun,
  finishCollectorRun,
  appendCollectorRunLog,
  collectHttpSnapshot,
  generateIdempotencyKey,
  getRun,
  NORMALIZATION_VERSION,
  type RunStats,
  type FetchFn
} from '@wetblob/lake-db';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to create mock fetch function
function createMockFetch(responseBody: string, status = 200): FetchFn {
  return async () => ({
    status,
    headers: { 'content-type': 'text/html' },
    body: Buffer.from(responseBody)
  });
}

// Helper to create failing mock fetch
function createFailingMockFetch(status = 404): FetchFn {
  return async () => ({
    status,
    headers: { 'content-type': 'text/plain' },
    body: Buffer.from('Error response')
  });
}

describe('Collector Runner', () => {
  const db = createDb();
  const migrationsDir = join(__dirname, '../../lake-db/migrations');

  beforeAll(async () => {
    await migrate(db, migrationsDir);
  });

  beforeEach(async () => {
    // Clean up tables between tests to ensure isolation
    await db.none(`DELETE FROM run_logs`);
    await db.none(`DELETE FROM run_outputs`);
    await db.none(`DELETE FROM run_inputs`);
    await db.none(`DELETE FROM edges`);
    await db.none(`DELETE FROM items`);
    await db.none(`DELETE FROM blobs`);
    await db.none(`DELETE FROM runs`);
  });

  afterAll(async () => {
    await db.$pool.end();
  });

  describe('Test 1: Idempotent run skip', () => {
    it('second run with same config in same hour bucket returns skipped with same run_id', async () => {
      const testHour = new Date('2026-01-30T12:00:00Z');
      const config = { urls: ['https://example.com/test'] };
      const idempotencyKey = generateIdempotencyKey(config, testHour);

      // First run should succeed
      const result1 = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'test_collector',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey,
        configSnapshot: config,
        db
      });

      expect(result1.runId).toBeDefined();
      expect(result1.status).toBe('running');

      // Second run with same idempotency key should throw idempotency conflict
      let thrownError: Error & { type?: string; existingRunId?: string } | null = null;
      try {
        await startCollectorRun({
          collectorType: 'http_snapshot',
          collectorName: 'test_collector',
          normalizationVersion: NORMALIZATION_VERSION,
          idempotencyKey,
          configSnapshot: config,
          db
        });
      } catch (error) {
        thrownError = error as Error & { type?: string; existingRunId?: string };
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.type).toBe('idempotency_conflict');
      expect(thrownError?.existingRunId).toBe(result1.runId);

      // Clean up
      await finishCollectorRun({
        runId: result1.runId,
        status: 'succeeded',
        stats: { urlsAttempted: 1, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: 1024 },
        db
      });
    });

    it('different hour bucket allows new run', async () => {
      const config = { urls: ['https://example.com/test2'] };
      const hour1 = new Date('2026-01-30T12:00:00Z');
      const hour2 = new Date('2026-01-30T13:00:00Z');

      const key1 = generateIdempotencyKey(config, hour1);
      const key2 = generateIdempotencyKey(config, hour2);

      const result1 = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'test_collector',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey: key1,
        configSnapshot: config,
        db
      });

      const result2 = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'test_collector',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey: key2,
        configSnapshot: config,
        db
      });

      expect(result1.runId).not.toBe(result2.runId);

      // Clean up
      await finishCollectorRun({ runId: result1.runId, status: 'succeeded', stats: { urlsAttempted: 1, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: 1024 }, db });
      await finishCollectorRun({ runId: result2.runId, status: 'succeeded', stats: { urlsAttempted: 1, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: 1024 }, db });
    });
  });

  describe('Test 2: Run lifecycle', () => {
    it('startCollectorRun creates run with status running', async () => {
      const config = { urls: ['https://example.com/lifecycle'] };
      const idempotencyKey = generateIdempotencyKey(config);

      const result = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'lifecycle_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey,
        configSnapshot: config,
        db
      });

      // Verify run was created
      const run = await getRun(db, result.runId);
      expect(run).not.toBeNull();
      expect(run?.status).toBe('running');
      expect(run?.run_id).toBe(result.runId);
      expect(run?.started_at).toBeDefined();
      expect(run?.finished_at).toBeNull();

      // Clean up
      await finishCollectorRun({
        runId: result.runId,
        status: 'succeeded',
        stats: { urlsAttempted: 1, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: 1024 },
        db
      });
    });

    it('finishCollectorRun with success sets status to succeeded and timestamps', async () => {
      const config = { urls: ['https://example.com/success'] };
      const idempotencyKey = generateIdempotencyKey(config);

      const result = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'success_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey,
        configSnapshot: config,
        db
      });

      const beforeFinish = new Date();

      await finishCollectorRun({
        runId: result.runId,
        status: 'succeeded',
        stats: { urlsAttempted: 1, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: 1024 },
        db
      });

      const run = await getRun(db, result.runId);
      expect(run?.status).toBe('succeeded');
      expect(run?.finished_at).toBeDefined();
      expect(run?.finished_at!.getTime()).toBeGreaterThanOrEqual(beforeFinish.getTime());
      expect(run?.error).toBeNull();
    });
  });

  describe('Test 3: Failure path', () => {
    it('finishCollectorRun with failure sets status to failed and captures errorSummary', async () => {
      const config = { urls: ['https://example.com/failure'] };
      const idempotencyKey = generateIdempotencyKey(config);

      const result = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'failure_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey,
        configSnapshot: config,
        db
      });

      const errorSummary = 'Failed to fetch 2 URLs: network timeout';

      await finishCollectorRun({
        runId: result.runId,
        status: 'failed',
        stats: { urlsAttempted: 2, urlsSucceeded: 0, itemsCreated: 0, bytesDownloaded: 0 },
        errorSummary,
        db
      });

      const run = await getRun(db, result.runId);
      expect(run?.status).toBe('failed');
      expect(run?.finished_at).toBeDefined();
      expect(run?.error).toBe(errorSummary);
    });
  });

  describe('Test 4: Partial success semantics', () => {
    it('run with mixed success/failure should track each URL attempt', async () => {
      const successUrl = 'https://example-success.com';
      const failUrl = 'https://example-fail.com';
      const config = { urls: [successUrl, failUrl] };
      const idempotencyKey = generateIdempotencyKey(config);

      const result = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'partial_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey,
        configSnapshot: config,
        db
      });

      // Create a mock fetch that succeeds for successUrl and fails for failUrl
      const mockFetch: FetchFn = async (url: string) => {
        if (url === successUrl) {
          return {
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: Buffer.from('<html><body>Success content</body></html>')
          };
        }
        return {
          status: 404,
          headers: { 'content-type': 'text/plain' },
          body: Buffer.from('Not found')
        };
      };

      // First URL succeeds
      const successResult = await collectHttpSnapshot(db, result.runId, { urls: [successUrl] }, mockFetch);
      expect(successResult).toHaveLength(1);
      expect(successResult[0].isNew).toBe(true);

      // Second URL fails - but collectHttpSnapshot throws on error
      // So we need to handle it
      try {
        await collectHttpSnapshot(db, result.runId, { urls: [failUrl] }, mockFetch);
      } catch (error) {
        // Expected to throw
        await appendCollectorRunLog({
          runId: result.runId,
          level: 'error',
          message: `Failed to collect ${failUrl}`,
          meta: { url: failUrl, error: String(error) },
          db
        });
      }

      // Add a log entry for the success
      await appendCollectorRunLog({
        runId: result.runId,
        level: 'info',
        message: `Successfully collected ${successUrl}`,
        meta: { url: successUrl, itemId: successResult[0].itemId },
        db
      });

      // Verify run logs exist for both attempts
      const logs = await db.any(
        `SELECT level, message FROM run_logs WHERE run_id = $1 ORDER BY created_at`,
        [result.runId]
      );

      const infoLogs = logs.filter((l: { level: string }) => l.level === 'info');
      const errorLogs = logs.filter((l: { level: string }) => l.level === 'error');

      expect(infoLogs.length).toBeGreaterThanOrEqual(1);
      expect(errorLogs.length).toBeGreaterThanOrEqual(1);

      // Finish run as succeeded since we got at least one item and no fatal error
      await finishCollectorRun({
        runId: result.runId,
        status: 'succeeded',
        stats: { urlsAttempted: 2, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: 512 },
        db
      });

      const run = await getRun(db, result.runId);
      expect(run?.status).toBe('succeeded');
    });
  });

  describe('Test 5: Stats aggregation', () => {
    it('correctly tracks urlsAttempted, urlsSucceeded, itemsCreated, bytesDownloaded', async () => {
      const urls = [
        'https://example-stats1.com',
        'https://example-stats2.com',
        'https://example-stats3.com'
      ];
      const config = { urls };
      const idempotencyKey = generateIdempotencyKey(config);

      const result = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'stats_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey,
        configSnapshot: config,
        db
      });

      const htmlContent = '<html><body>Test content for stats</body></html>';
      const mockFetch = createMockFetch(htmlContent);

      // Collect all URLs
      const snapshotResults = await collectHttpSnapshot(db, result.runId, config, mockFetch);

      expect(snapshotResults).toHaveLength(3);
      expect(snapshotResults.every(r => r.isNew)).toBe(true);

      const stats: RunStats = {
        urlsAttempted: urls.length,
        urlsSucceeded: snapshotResults.length,
        itemsCreated: snapshotResults.filter(r => r.isNew).length,
        bytesDownloaded: htmlContent.length * urls.length
      };

      expect(stats.urlsAttempted).toBe(3);
      expect(stats.urlsSucceeded).toBe(3);
      expect(stats.itemsCreated).toBe(3);
      expect(stats.bytesDownloaded).toBe(htmlContent.length * 3);

      await finishCollectorRun({
        runId: result.runId,
        status: 'succeeded',
        stats,
        db
      });

      // Verify stats are persisted in run metrics
      const run = await getRun(db, result.runId);
      expect(run?.metrics).toBeDefined();
      expect(run?.metrics.stats).toEqual(stats);
    });

    it('correctly tracks stats with superseded items', async () => {
      const url = 'https://example-superseded.com';
      const htmlContent1 = '<html><body>Original content</body></html>';
      const htmlContent2 = '<html><body>Updated content</body></html>';

      // First run - creates new item
      const config1 = { urls: [url] };
      const idempotencyKey1 = generateIdempotencyKey(config1);

      const result1 = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'superseded_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey: idempotencyKey1,
        configSnapshot: config1,
        db
      });

      const mockFetch1 = createMockFetch(htmlContent1);
      const snapshotResults1 = await collectHttpSnapshot(db, result1.runId, config1, mockFetch1);

      expect(snapshotResults1[0].isNew).toBe(true);

      await finishCollectorRun({
        runId: result1.runId,
        status: 'succeeded',
        stats: { urlsAttempted: 1, urlsSucceeded: 1, itemsCreated: 1, bytesDownloaded: htmlContent1.length },
        db
      });

      // Second run - same URL but different content (supersedes first item)
      const config2 = { urls: [url] };
      const idempotencyKey2 = generateIdempotencyKey(config2, new Date(Date.now() + 3600000)); // Different hour

      const result2 = await startCollectorRun({
        collectorType: 'http_snapshot',
        collectorName: 'superseded_test',
        normalizationVersion: NORMALIZATION_VERSION,
        idempotencyKey: idempotencyKey2,
        configSnapshot: config2,
        db
      });

      const mockFetch2 = createMockFetch(htmlContent2);
      const snapshotResults2 = await collectHttpSnapshot(db, result2.runId, config2, mockFetch2);

      // Second item supersedes first, so isNew is false
      expect(snapshotResults2[0].isNew).toBe(false);
      expect(snapshotResults2[0].supersededItemId).toBe(snapshotResults1[0].itemId);

      // Stats should show 0 items created since it was superseded
      await finishCollectorRun({
        runId: result2.runId,
        status: 'succeeded',
        stats: {
          urlsAttempted: 1,
          urlsSucceeded: 1,
          itemsCreated: snapshotResults2.filter(r => r.isNew).length, // 0
          bytesDownloaded: htmlContent2.length
        },
        db
      });

      const run2 = await getRun(db, result2.runId);
      expect(run2?.metrics.stats.itemsCreated).toBe(0);
      expect(run2?.metrics.stats.urlsAttempted).toBe(1);
      expect(run2?.metrics.stats.urlsSucceeded).toBe(1);
    });
  });
});
