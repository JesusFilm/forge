---
title: "Gateway Sync: Local Testing Runbook"
category: cms
date: 2026-03-23
tags: [gateway-sync, strapi, api-token, limited-import, testing, runbook]
---

# Gateway Sync: Local Testing Runbook

## Context

`POST /api/gateway-sync/trigger` drives both full syncs and limited (collection-scoped) seed imports.
This runbook covers end-to-end local validation: environment setup, auth, dry-run, live import, and guard testing.

Related code: `apps/cms/src/api/gateway-sync/`
Related PR: #514 — feat(cms): add limited seed import to gateway-sync pipeline

---

## Critical Auth Gotcha

The gateway-sync routes use the `admin::isAuthenticatedAdmin` policy under `/api/` (content-API scope).

**Admin JWT tokens return 401 on these routes.** The content-API auth middleware does not process admin JWTs — it only processes API tokens. Always generate a full-access API token (Step 2) and use that.

---

## Step 1 — Environment setup

```bash
# Fetch all secrets from Doppler
cd apps/cms && pnpm fetch-secrets

# Append the limited-import feature flag to .env
echo "GATEWAY_SYNC_ENABLE_LIMITED_IMPORT=true" >> apps/cms/.env

# Start Strapi
pnpm --filter cms dev
# Wait for: "Strapi started successfully"
```

---

## Step 2 — Create admin user (blank DB only)

Skip if your `.tmp/data.db` already has an admin.

```bash
curl -s -X POST http://localhost:1337/admin/register-admin \
  -H "Content-Type: application/json" \
  -d '{"firstname":"Admin","lastname":"Local","email":"admin@local.dev","password":"<choose-a-local-password>"}' \
  | jq .data.user.email
```

---

## Step 3 — Generate a full-access API token

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:1337/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.dev","password":"<your-local-password>"}' \
  | jq -r '.data.token')

API_TOKEN=$(curl -s -X POST http://localhost:1337/admin/api-tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"name":"test-local","description":"local testing","type":"full-access","lifespan":null}' \
  | jq -r '.data.accessKey')

echo "API_TOKEN=$API_TOKEN"
```

Export this for subsequent steps:

```bash
export API_TOKEN=<value from above>
```

---

## Step 4 — Find valid gateway collection IDs

The gateway uses its own ID format — not slugs. Known working IDs:

| Content                        | Gateway ID  |
| ------------------------------ | ----------- |
| JESUS film                     | `1_jf-0-0`  |
| Life of Jesus (Gospel of John) | `2_GOJ-0-0` |
| How Did We Get Here? Episode 1 | `7_0-nfs01` |

To discover IDs from the live gateway:

```bash
# Feature films
curl -s -X POST https://api-gateway.central.jesusfilm.org/ \
  -H "Content-Type: application/json" \
  -d '{"query":"{ videos(where: { labels: [featureFilm], published: true }, limit: 20) { id label } }"}' \
  | jq .

# Collections
curl -s -X POST https://api-gateway.central.jesusfilm.org/ \
  -H "Content-Type: application/json" \
  -d '{"query":"{ videos(where: { labels: [collection], published: true }, limit: 20) { id label } }"}' \
  | jq .
```

---

## Step 5 — Dry-run (resolves IDs, no import)

```bash
curl -s -X POST http://localhost:1337/api/gateway-sync/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"collectionIds":["1_jf-0-0"],"dryRun":true}' | jq .
```

**Healthy response:**

```json
{
  "dryRun": {
    "isFullSync": false,
    "requestedCollectionIds": ["1_jf-0-0"],
    "collectionVideoIds": { "1_jf-0-0": ["1_jf6101-0-0", "...61 total"] },
    "resolvedVideoIds": ["1_jf6101-0-0", "..."],
    "missingCollectionIds": []
  }
}
```

If `missingCollectionIds` is non-empty: the ID is wrong or not published — revisit Step 4.

---

## Step 6 — Run the limited import

Returns `202 Accepted` immediately (fire-and-forget background job).

```bash
curl -s -X POST http://localhost:1337/api/gateway-sync/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"collectionIds":["1_jf-0-0"]}' | jq .
```

Watch the Strapi terminal for:

```
[gateway-sync] Limited import: 61 resolved video IDs from 1 collections
[gateway-sync] Limited video sync complete: X created, Y updated, 0 errors (soft-delete skipped)
[gateway-sync] Limited variant sync complete: X created, Y updated, 0 errors (soft-delete skipped)
```

---

## Step 7 — Poll sync status

```bash
curl -s http://localhost:1337/api/gateway-sync/status \
  -H "Authorization: Bearer $API_TOKEN" | jq .
```

---

## Step 8 — Verify the guard (negative test)

1. Remove `GATEWAY_SYNC_ENABLE_LIMITED_IMPORT=true` from `.env`
2. Restart Strapi
3. Repeat Step 6

Expected: error response refusing the limited import, not 202.

---

## Validation checklist

| Check                         | What to verify                                   |
| ----------------------------- | ------------------------------------------------ |
| Only selected videos imported | Video count ≈ `resolvedVideoIds.length`          |
| No soft-deletes               | Strapi logs show `soft-delete skipped`           |
| Idempotent                    | Second run shows `updated`, not `created`        |
| Variants linked               | Imported videos have variants in Content Manager |
| Guard works                   | Without env flag, limited import is rejected     |

---

## Verified regression scenario: `7_0-nfs01`

Use this exact scenario to validate the draft/publish fix for relation-heavy child content.

### Clean run

```bash
curl -s -X POST http://localhost:1337/api/gateway-sync/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"collectionIds":["7_0-nfs01"],"scope":["languages","countries","keywords","videos","video-variants"]}' | jq .
```

Expected terminal log summary:

```text
[gateway-sync] languages: 2280c/0u/0d/0e
[gateway-sync] countries: 240c/0u/0d/0e
[gateway-sync] keywords: 6030c/0u/0d/0e
[gateway-sync] videos: 4c/0u/0d/0e
[gateway-sync] video-variants: 72c/0u/0d/0e
```

Expected publish summary includes:

```text
Published 2280 draft language records
Published 6598 draft country-language records
Published 6030 draft keyword records
Published 4 draft video records
Published 39 draft video-subtitle records
Published 72 draft video-variant records
Published 4 draft bible-citation records
Published 9 draft video-study-question records
```

### Warm rerun

Run the same command again without wiping the DB only if you are explicitly testing the still-open
rerun/update issue.

Current status: warm rerun is not yet a required pass condition for this fix. The clean import path
above is verified; rerun behavior is still being investigated separately.

### SQLite verification

```bash
sqlite3 apps/cms/.tmp/data.db "
select 'videos', count(*), sum(case when published_at is not null then 1 else 0 end) from videos
union all
select 'video_subtitles', count(*), sum(case when published_at is not null then 1 else 0 end) from video_subtitles
union all
select 'video_variants', count(*), sum(case when published_at is not null then 1 else 0 end) from video_variants
union all
select 'bible_citations', count(*), sum(case when published_at is not null then 1 else 0 end) from bible_citations
union all
select 'video_study_questions', count(*), sum(case when published_at is not null then 1 else 0 end) from video_study_questions;
"
```

Expected result after the clean run:

```text
videos|8|4
video_subtitles|78|39
video_variants|144|72
bible_citations|8|4
video_study_questions|18|9
```

The left value is total rows, the right value is published rows. The doubled total is normal
for Strapi v5 draft/publish because published documents keep their draft row.
