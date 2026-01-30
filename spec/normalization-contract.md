# Normalization Contract

Version: 1.0.0
Last updated: 2026-01-30

## Purpose

Defines the contract for URL normalization, content hashing, and versioning rules for the wetblob ingest pipeline. Ensures deterministic deduplication and lineage tracking across collector runs.

---

## 1. Normalization Version

The `normalization_version` field in the `runs` table tracks which version of normalization logic produced a given item. This enables:
- **Reprocessing detection**: Identify items that need re-normalization when logic changes
- **Comparability**: Determine if two items can be directly compared
- **Lineage tracking**: Track which collector runs can be considered equivalent

### Current Version

```
http_snapshot_url_v1_text_v1
```

Format: `<collector>_<component>_v<version>[_<component>_v<version>...]`

---

## 2. When to Bump Normalization Version

Bump the normalization version when ANY of the following change:

### 2.1 URL Normalization (`*_url_v*`) 

Bump when:
- Tracking parameters list changes (added/removed)
- URL component handling changes (ports, fragments, encoding)
- Path normalization logic changes (trailing slashes, case sensitivity)
- Query parameter sorting logic changes

**Impact**: Existing items may have different `canonical_uri` values; reprocessing recommended.

### 2.2 Content Hash Normalization (`*_text_v*`)

Bump when:
- HTML-to-text extraction logic changes
- Whitespace normalization changes
- Content filtering changes (script removal, etc.)
- Hash algorithm or input changes

**Impact**: Same content may produce different `content_sha256`; reprocessing recommended.

### 2.3 Do NOT Bump When

- Bug fixes that bring behavior into compliance with existing spec
- Performance optimizations that don't change output
- Logging or metadata changes

---

## 3. Cross-Version Comparison Rules

### 3.1 Same Normalization Version

Items with the **same** `normalization_version`:
- CAN be compared directly via `canonical_uri` and `content_sha256`
- Dedupe edges are valid and meaningful
- Supersedes chains are continuous

### 3.2 Different Normalization Version

Items with **different** `normalization_version`:
- MUST NOT be compared for deduplication purposes
- SHOULD be considered independent lineages
- MAY coexist without supersedes edges

Example:
```
Item A (v1): canonical_uri = "https://example.com/page"
Item B (v2): canonical_uri = "https://example.com/page" (same after normalization change)

Result: NO supersedes edge between A and B (different normalization versions)
```

### 3.3 Backfill/Reprocessing Strategy

When bumping normalization version:

1. **New items** use the new version automatically
2. **Existing items** remain with old version (immutable)
3. **Optional backfill**: Create new collector runs with `reprocessing_of_run_id` pointing to original
4. **Comparison queries** should filter by normalization_version when looking for duplicates

---

## 4. Multiple-Match Conflict Resolution

When an incoming item matches **different** existing items via `canonical_uri` vs `content_sha256`:

### 4.1 Priority Rules (in order)

1. **Content hash wins over URI**: If `content_sha256` matches Item A and `canonical_uri` matches Item B, the content match (Item A) takes precedence.
   - Rationale: Content is the ground truth; URI is just an addressing mechanism.

2. **Most recent as fallback**: If both match the same field type (both URI or both hash), use the most recently created item.

3. **Tie-breaker**: If timestamps are identical, use lexicographically larger `item_id`.

### 4.2 Conflict Detection

A conflict occurs when:
```
existingByUri.item_id !== existingByHash.item_id
```

Resolution:
```
if (existingByHash) {
  supersededItem = existingByHash;  // Content match wins
  conflictReason = 'content_hash_priority';
} else if (existingByUri) {
  supersededItem = existingByUri;
  conflictReason = 'canonical_uri';
}
```

### 4.3 Edge Metadata

Conflict resolution MUST be recorded in the `supersedes` edge metadata:

```json
{
  "reason": "same_content_sha256",
  "conflict_resolved": true,
  "canonical_uri_match": "<uri_match_item_id or null>",
  "content_sha256_match": "<hash_match_item_id or null>",
  "selected": "content_sha256"
}
```

---

## 5. Migration Guidelines

### Adding New Tracking Parameters

1. Add parameter to `TRACKING_PARAMS` in `normalize.ts`
2. Bump `*_url_v*` component of normalization version
3. Document in CHANGELOG

### Changing Content Extraction

1. Update `extractTextFromHtml()` or equivalent
2. Bump `*_text_v*` component of normalization version  
3. Document in CHANGELOG

### Version String Format

Use semantic versioning within each component:
- `v1` → `v2` for breaking changes
- Add patch if needed: `v2.1`

Full version example: `http_snapshot_url_v2_text_v1.1`

---

## 6. Invariants

1. **Version immutability**: Once a run is created, its `normalization_version` never changes
2. **Item immutability**: Once an item is created, its `canonical_uri` and `content_sha256` never change
3. **Comparison validity**: Only compare items with identical `normalization_version`
4. **Conflict logging**: All conflicts MUST be recorded in edge metadata

---

## Appendix: Current Implementation

- URL normalization: [`packages/lake-db/src/collect/normalize.ts`](packages/lake-db/src/collect/normalize.ts)
- Collector version: [`packages/lake-db/src/collect/idempotency.ts`](packages/lake-db/src/collect/idempotency.ts)
- Conflict resolution: [`packages/lake-db/src/collect/http-snapshot.ts`](packages/lake-db/src/collect/http-snapshot.ts)
