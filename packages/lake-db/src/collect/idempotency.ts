import { createHash } from 'crypto';

export interface CollectorConfig {
  urls: string[];
}

// Normalization version for lineage tracking
export const NORMALIZATION_VERSION = 'http_snapshot_url_v1_text_v1';
export const COLLECTOR_VERSION = '0.1.0';

/**
 * Deterministically hash the collector config for idempotency key generation.
 * Sorts URLs, uses stable key order, and hashes the full effective config.
 */
export function hashConfig(config: CollectorConfig): string {
  // Normalize and sort URLs for stable ordering
  const normalizedUrls = [...config.urls]
    .map(url => url.toLowerCase().trim())
    .sort();

  // Build deterministic JSON with sorted keys
  const deterministicConfig = {
    urls: normalizedUrls,
  };

  const json = JSON.stringify(deterministicConfig, Object.keys(deterministicConfig).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Generate an idempotency key based on date, hour, and config hash.
 * Same hour + same config => same key
 * Same hour + different config => different key
 */
export function generateIdempotencyKey(config: CollectorConfig, date?: Date): string {
  const now = date || new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();
  const configHash = hashConfig(config);
  return `http_snapshot:${dateStr}:${hour}:${configHash}`;
}
