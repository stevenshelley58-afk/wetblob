import { Db } from '../db.js';
import { putBlob } from '../store.blob.js';
import { createItem, findItemsByCanonicalUri, findItemsByContentSha256 } from '../store.items.js';
import { createEdge } from '../store.edges.js';
import { addRunOutput, appendRunLog } from '../store.runs.js';
import { normalizeUrl, computeContentSha256 } from './normalize.js';

export interface HttpSnapshotConfig {
  urls: string[];
}

export interface HttpSnapshotResult {
  itemId: string;
  url: string;
  canonicalUri: string;
  isNew: boolean;
  supersededItemId?: string;
}

/**
 * Fetch a URL and return the response body as Buffer
 * In a real implementation, this would use fetch/axios
 * For testing, we allow injection of a fetch function
 */
export type FetchFn = (url: string) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;

/**
 * Default fetch implementation using global fetch
 */
async function defaultFetch(url: string): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: Buffer.from(arrayBuffer)
  };
}

/**
 * Collect a single URL snapshot
 */
async function collectUrl(
  db: Db,
  runId: string,
  url: string,
  observedAt: Date,
  fetchFn: FetchFn = defaultFetch
): Promise<HttpSnapshotResult> {
  // Normalize URL for canonical_uri
  const canonicalUri = normalizeUrl(url);
  
  // Fetch the URL
  const response = await fetchFn(url);
  
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  
  const bytes = response.body;
  const mimeType = response.headers['content-type']?.split(';')[0] || 'text/html';
  
  // Store blob (content-addressed, idempotent)
  const blobResult = await putBlob(db, { bytes, mimeType });
  
  // Compute content_sha256 for dedupe
  const contentSha256 = computeContentSha256(bytes.toString('utf-8'), true);
  
  // Check for existing items by canonical_uri OR content_sha256
  const existingByUri = canonicalUri ? await findItemsByCanonicalUri(db, canonicalUri) : [];
  const existingByHash = await findItemsByContentSha256(db, contentSha256);
  
  // Get most recent from each category
  const uriMatch = existingByUri.length > 0
    ? existingByUri.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : null;
  const hashMatch = existingByHash.length > 0
    ? existingByHash.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    : null;
  
  // Conflict resolution: content_sha256 match wins over canonical_uri match
  // Per normalization-contract.md Section 4
  let existingItem: typeof uriMatch = null;
  let conflictResolved = false;
  let selectedMatch: 'content_sha256' | 'canonical_uri' | null = null;
  
  if (hashMatch && uriMatch && hashMatch.item_id !== uriMatch.item_id) {
    // Conflict: hash matches one item, URI matches a different item
    existingItem = hashMatch; // Content is ground truth
    conflictResolved = true;
    selectedMatch = 'content_sha256';
  } else if (hashMatch) {
    existingItem = hashMatch;
    selectedMatch = 'content_sha256';
  } else if (uriMatch) {
    existingItem = uriMatch;
    selectedMatch = 'canonical_uri';
  }
  
  // Create the new item
  const item = await createItem(db, {
    type: 'intel.webpage',
    source_type: 'collector',
    source_id: 'http_snapshot',
    external_ref: url,
    canonical_uri: canonicalUri,
    content_sha256: contentSha256,
    observed_at: observedAt,
    blob_id: blobResult.blobId,
    meta: {
      fetch_status: response.status,
      fetch_headers: response.headers,
      blob_inserted: blobResult.inserted
    }
  });
  
  // Link to run output
  await addRunOutput(db, runId, item.item_id);
  
  // If existing item found, create supersedes edge
  if (existingItem && existingItem.item_id !== item.item_id) {
    // Build edge metadata per normalization-contract.md Section 4.3
    const edgeMeta: Record<string, unknown> = {
      reason: selectedMatch,
      original_canonical_uri: existingItem.canonical_uri,
      new_canonical_uri: canonicalUri
    };
    
    if (conflictResolved) {
      edgeMeta.conflict_resolved = true;
      edgeMeta.canonical_uri_match = uriMatch?.item_id ?? null;
      edgeMeta.content_sha256_match = hashMatch?.item_id ?? null;
      edgeMeta.selected = selectedMatch;
    }
    
    await createEdge(db, {
      from_item_id: existingItem.item_id,
      to_item_id: item.item_id,
      rel: 'supersedes',
      meta: edgeMeta
    });
    
    const logMessage = conflictResolved
      ? `Conflict resolved: content_sha256 match (${hashMatch?.item_id}) takes precedence over canonical_uri match (${uriMatch?.item_id})`
      : `Found existing item ${existingItem.item_id} with same ${selectedMatch}, linked via supersedes edge`;
    
    await appendRunLog(db, runId, conflictResolved ? 'warn' : 'info', logMessage, {
      existing_item_id: existingItem.item_id,
      new_item_id: item.item_id,
      conflict_resolved: conflictResolved,
      selected_match: selectedMatch
    });
    
    return {
      itemId: item.item_id,
      url,
      canonicalUri,
      isNew: false,
      supersededItemId: existingItem.item_id
    };
  }
  
  await appendRunLog(db, runId, 'info', `Created new item ${item.item_id} for ${url}`,
    { item_id: item.item_id, canonical_uri: canonicalUri }
  );
  
  return {
    itemId: item.item_id,
    url,
    canonicalUri,
    isNew: true
  };
}

/**
 * Run the http_snapshot collector
 */
export async function collectHttpSnapshot(
  db: Db,
  runId: string,
  config: HttpSnapshotConfig,
  fetchFn?: FetchFn
): Promise<HttpSnapshotResult[]> {
  const observedAt = new Date();
  const results: HttpSnapshotResult[] = [];
  
  await appendRunLog(db, runId, 'info', `Starting http_snapshot collector`, {
    url_count: config.urls.length,
    urls: config.urls
  });
  
  for (const url of config.urls) {
    try {
      const result = await collectUrl(db, runId, url, observedAt, fetchFn);
      results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await appendRunLog(db, runId, 'error', `Failed to collect ${url}`, { error: errorMessage });
      throw error;
    }
  }
  
  await appendRunLog(db, runId, 'info', `Completed http_snapshot collector`, {
    success_count: results.length,
    new_items: results.filter(r => r.isNew).length,
    superseded_items: results.filter(r => !r.isNew).length
  });
  
  return results;
}