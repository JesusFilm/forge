---
title: "Gateway Sync Limited Import: Bugs Found During Local Testing"
category: cms
date: 2026-03-23
tags:
  [
    gateway-sync,
    limited-import,
    apollo-client,
    query-complexity,
    null-safety,
    strapi-v5,
    error-handling,
    entity-validator,
    draft-publish,
  ]
symptoms:
  - "TypeError: Cannot read properties of undefined (reading 'keywords') at syncKeywords"
  - "TypeError: Cannot read properties of null (reading 'videos') at syncVideosLimited"
  - "Gateway returns INTERNAL_SERVER_ERROR with data: null for large collections"
  - "ValidationError: 1 relation(s) of type api::video-edition.video-edition associated with this entity do not exist"
component: gateway-sync
pr: "#514"
related:
  - docs/solutions/cms/gateway-sync-local-testing.md
  - docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md
---

# Gateway Sync Limited Import: Bugs Found During Local Testing

Discovered during local testing of the PR #514 limited seed import feature. Three bugs
found and all three resolved.

---

## Bug 1: Keywords Sync — Missing Null Guard on Apollo `data` (FIXED)

### Symptom

```
[gateway-sync] Sync failed after 68.8s: TypeError: Cannot read properties of undefined (reading 'keywords')
    at syncKeywords (sync-keywords.js:27:27)
```

### Root Cause

`sync-keywords.ts` destructures `data` from the Apollo response and immediately accesses
`.keywords` without a null check:

```ts
// sync-keywords.ts lines 35–36
const { data } = await getGatewayClient().query({ query: KEYWORDS_QUERY })
const keywords = data.keywords // 💥 crashes if data is undefined
```

With `errorPolicy: 'all'` configured on the Apollo client, when the gateway returns
GraphQL errors alongside `"data": null`, Apollo resolves to `{ data: undefined, errors: [...] }`.
The destructure succeeds but `data` is `undefined`, so `.keywords` throws.

### Fix (Applied)

Changed to use Apollo's `error` field (singular `ApolloError`, not `errors` array) and
null-guard `data` before accessing `.keywords`:

```ts
const { data, error } = await getGatewayClient().query({
  query: KEYWORDS_QUERY,
})

if (error) {
  strapi.log.warn(
    `[gateway-sync] Keywords query returned errors: ${error.message}`,
  )
}

const keywords = data?.keywords
if (!keywords || keywords.length === 0) {
  // circuit breaker: skip sync
}
```

**Key learning:** Apollo Client `query()` returns `{ data, error }` where `error` is an
`ApolloError` (with `.graphQLErrors` array inside), **not** a top-level `errors` array.
TypeScript will reject `{ data, errors }` destructuring.

---

## Bug 2: Videos Limited Sync — Query Complexity Overflow for Large Collections (FIXED)

### Symptom

```
[gateway-sync] Fetching 61 selected videos from gateway
[gateway-sync] Failed to fetch selected videos: TypeError: Cannot read properties of null (reading 'videos')
    at syncVideosLimited (sync-videos.js:569:23)
[gateway-sync] Limited video sync complete: 0 created, 0 updated, 0 errors
```

Gateway response (verified via direct curl):

```json
{
  "data": null,
  "errors": [
    {
      "message": "Unexpected error.",
      "extensions": { "code": "INTERNAL_SERVER_ERROR" }
    }
  ]
}
```

### Root Cause

`syncVideosLimited` sends **all** resolved video IDs in a single `SELECTED_VIDEOS_QUERY`
call. The JESUS Film collection resolves to 61 chapters. Each chapter has:

- ~2200 variants (with downloads, muxVideo, subtitles)
- ~94 subtitles
- bibleCitations, images, keywords, children

This query complexity exceeds the gateway's budget. The gateway returns `data: null` with
an `INTERNAL_SERVER_ERROR`. Apollo propagates `null` as `data`, so `data.videos` throws.

Note: The `catch` block in `syncVideosLimited` (lines 767–771) does catch the error and
logs it correctly — but returns empty stats, making the failure silent in the final output
(`0c/0u/0d/0e` instead of a visible error count).

### Workaround (Confirmed Working)

Use explicit `videoIds` with a small batch instead of `collectionIds` for large collections:

```json
POST /api/gateway-sync/trigger
{
  "videoIds": ["1_jf6101-0-0", "1_jf6102-0-0", "1_jf6103-0-0", "1_jf6104-0-0", "1_jf6105-0-0"],
  "scope": ["videos", "video-variants"]
}
```

5 explicit IDs → gateway returned all 5 cleanly, `5c/0u/0d/0e`.

### Fix (Applied)

Extracted `fetchSelectedVideosBatched()` that splits IDs into chunks of
`SELECTED_VIDEOS_BATCH_SIZE` (currently 10). Each batch queries the gateway independently
with null-guard on the response. Failed batches log a warning and skip, allowing remaining
batches to succeed.

**Files changed:**

- `sync-videos.ts`: Added `fetchSelectedVideosBatched()`, `SELECTED_VIDEOS_BATCH_SIZE = 10`

### Safe Batch Size Discovery

| Batch size | Status                            |
| ---------- | --------------------------------- |
| 5          | ✅ Known safe                     |
| 10         | ✅ Current default                |
| 15         | Untested                          |
| 20         | Untested                          |
| 61         | ❌ Triggers INTERNAL_SERVER_ERROR |

---

## Local Testing Quick Reference

```bash
# 1. Set env guard
echo "GATEWAY_SYNC_ENABLE_LIMITED_IMPORT=true" >> apps/cms/.env.local

# 2. Start CMS
pnpm --filter cms dev

# 3. Get API token (admin JWT doesn't work for content API)
ADMIN_TOKEN=$(curl -s -X POST http://localhost:1337/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"Admin1234!"}' | jq -r '.data.token')

API_TOKEN=$(curl -s -X POST http://localhost:1337/admin/api-tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"test","type":"full-access","lifespan":null}' | jq -r '.data.accessKey')

# 4. Dry-run to validate collection resolves
curl -s -X POST http://localhost:1337/api/gateway-sync/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"collectionIds":["your-collection-id"],"dryRun":true}' | jq .

# 5. Import — use small explicit videoIds to avoid query complexity limit
curl -s -X POST http://localhost:1337/api/gateway-sync/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"videoIds":["id1","id2","id3","id4","id5"],"scope":["videos","video-variants"]}' | jq .

# 6. Poll status
curl -s http://localhost:1337/api/gateway-sync/status \
  -H "Authorization: Bearer $API_TOKEN" | jq .
```

**Known safe collections for testing**:

- `7_0-nfs01` — "How Did We Get Here? (Episode 1)" — 3 child episodes, 54 variants. Confirmed working.
- `1_jf-0-0` (JESUS Film, 61 chapters) — now works with batching but is very large (61 × ~2200 variants)

---

## Bug 3: Strapi v5 Entity Validator Rejects Published Creates (FIXED)

### Symptom

```
[gateway-sync] Failed to upsert variant 7_496-0-nfs0101: ValidationError: 1 relation(s) of
type api::video-edition.video-edition associated with this entity do not exist
    at createEntry (entries.js:63:27)
```

All variant creates fail with this error even though the referenced video-edition records
exist in the database.

### Root Cause

Strapi v5 Document Service `create({status: "published"})` internally:

1. Creates a **draft** row (passes entity validator with `isDraft: true`)
2. Deep-populates the draft's relation data from link tables
3. Calls `createEntry` again to create the **published** row

Step 3 runs the entity validator with `isDraft: false`. The deep-populated relation data
from the draft's link tables fails validation during this internal publish step. The exact
mechanism involves how Strapi resolves relation IDs during the deep-populate/re-create cycle
— the IDs from the draft's link tables don't pass the published-status validation check.

Key observation: draft creates with documentId strings for relations PASS validation (the
draft row and its link table entries are created successfully — confirmed by checking the
DB after failures). The error only occurs in the publish step's internal `createEntry`.

### Fix (Applied)

The final fix required more than "create as draft, then call `publish()` later."

Applied changes:

- `upsertByGatewayId` now writes gateway-owned records as drafts for both **create and update**
- `publishDrafts()` now discovers document IDs that still have **no published row**, instead of
  paging over raw `published_at IS NULL` rows
- `publishDrafts()` now tracks attempted document IDs so a permanently failing publish cannot
  spin forever in a hot loop
- `gateway-sync.ts` now treats publish failures as sync failures instead of warning-only noise
- the importer now uses direct many-to-one document relations for `video` (`video: videoDocId`)
  instead of mixing in `connect` arrays and raw join-table repair
- the raw `repairVideoChildRelationLinks()` workaround was removed

**Why this works:**

1. Draft-first create/update still avoids Strapi's internal published-create validator problem
2. Publishing by document ID works once relation payloads stay inside Document Service semantics
3. Strapi v5 keeps a draft row after publish, so the publish finder must select document IDs
   that do not yet have any published row; otherwise large types stall after the first batch
4. Warm rerun behavior is still unresolved on Strapi `5.36.0`; this fix only verifies the clean import path

### Verified Result

Clean local import of collection `7_0-nfs01` on Strapi `5.36.0`:

```
languages: 2280c/0u/0d/0e
countries: 240c/0u/0d/0e
keywords: 6030c/0u/0d/0e
videos: 4c/0u/0d/0e
video-variants: 72c/0u/0d/0e
Published 2280 draft language records
Published 6598 draft country-language records
Published 6030 draft keyword records
Published 1 draft video-origin records
Published 16 draft video-edition records
Published 52 draft mux-video records
Published 4 draft video records
Published 39 draft video-subtitle records
Published 72 draft video-variant records
Published 4 draft bible-citation records
Published 9 draft video-study-question records
```

Known limitation: warm rerun of the same collection is still not reliable on Strapi `5.36.0`.
The remaining failures are in the rerun/update path, not the clean import path documented here.

---

## Prevention Checklist

- [x] Null-guard every `const { data } = await getGatewayClient().query(...)` before accessing fields
- [x] Batch video ID queries via `fetchSelectedVideosBatched()` with `SELECTED_VIDEOS_BATCH_SIZE = 10`
- [x] Create drafts then bulk-publish to avoid Strapi v5 entity validator relation errors
- [ ] Always dry-run (`dryRun: true`) against an unknown collection before a live import
- [ ] Detect `INTERNAL_SERVER_ERROR` with `data: null` separately from partial-data errors

---

## See Also

- `docs/solutions/cms/gateway-sync-local-testing.md` — full local setup runbook
- `docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md` — relation clearing patterns used in sync-videos
- PR #514: feat(cms): add limited seed import to gateway-sync pipeline
