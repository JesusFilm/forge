---
title: "CMS easter experience seed function existed but was never called during bootstrap"
date: 2026-03-30
problem_type: runtime_error
component: database
root_cause: incomplete_setup
resolution_type: seed_data_update
severity: critical
module: apps/cms
tags:
  - cms
  - strapi
  - seed-data
  - bootstrap
  - production-outage
  - easter
  - fire-and-forget
  - operational-endpoint
files_changed:
  - apps/cms/src/api/seed-easter/controllers/seed-easter.ts
  - apps/cms/src/api/seed-easter/routes/seed-easter.ts
  - apps/cms/src/bootstrap/seed-easter.ts
related:
  - docs/solutions/cms/strapi-v5-bootstrap-webhook-seeding.md
  - docs/solutions/platform/cms-database-snapshot-restore-automation.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
github_issues:
  - "#491"
  - "#487"
  - "#414"
---

## Problem

The `/watch/easter` page on `watch.jesusfilm.org` returned "Failed to load experience: No content is available" because the Strapi v5 CMS had no easter experience record. A `seedEaster()` function existed in `apps/cms/src/bootstrap/seed-easter.ts` but was never called from the bootstrap lifecycle in `apps/cms/src/index.ts`.

## Symptoms

- `watch.jesusfilm.org/watch/easter` displayed `ExperienceError` with "No content is available"
- The GraphQL query in `apps/web/src/lib/content.ts` (`getWatchExperience`) returned an empty `experiences` array
- The `experiences` table was not in the data-snapshot allowlist, so snapshots never restored it
- The legacy site at `www.jesusfilm.org/watch/easter` worked fine (completely different SSG-based app)

## What Didn't Work

1. **Adding `seedEaster()` to bootstrap**: Would overwrite manual CMS edits on every deploy. Content editors need to tweak the experience without reset.
2. **Standalone tsx script**: `seedEaster()` depends on `strapi.documents()` which requires a running Strapi instance.
3. **Knex transaction wrapping**: Strapi's document service does not accept external transaction objects, so atomic delete-then-create is not possible.
4. **Create-with-staging-slug-then-swap**: The `slug` field is a Strapi UID with a unique constraint. Two records with different slugs can't coexist for a swap.

## Solution

Expose `seedEaster()` as an on-demand HTTP endpoint following the existing `data-snapshot` patterns.

### 1. Fire-and-forget controller with concurrency guard

```typescript
// apps/cms/src/api/seed-easter/controllers/seed-easter.ts
let seedStatus = { state: "idle", startedAt: null, finishedAt: null, error: null }

async trigger(ctx) {
  if (seedStatus.state === "running") {
    ctx.status = 409  // Concurrency guard
    ctx.body = { error: "Seed already in progress" }
    return
  }
  seedStatus = { state: "running", startedAt: new Date().toISOString(), ... }

  // Fire and forget -- return 202 immediately
  seedEaster(strapi)
    .then(() => { seedStatus = { state: "done", ... } })
    .catch((err) => { seedStatus = { state: "failed", error: err.message, ... } })

  ctx.status = 202
  ctx.body = { message: "Easter seed started", status: getSeedStatus() }
}
```

### 2. Dual-auth routes (secret-auth for CI/agents, admin-auth for Strapi panel)

```typescript
// apps/cms/src/api/seed-easter/routes/seed-easter.ts
{ method: "POST", path: "/seed-easter/trigger", middlewares: ["api::data-snapshot.secret-auth"] }
{ method: "GET",  path: "/seed-easter/status",  middlewares: ["api::data-snapshot.secret-auth"] }
{ method: "POST", path: "/seed-easter/admin/trigger", middlewares: ["global::admin-auth"] }
{ method: "GET",  path: "/seed-easter/admin/status",  middlewares: ["global::admin-auth"] }
```

### 3. Safe delete-then-create with placeholder fallback

```typescript
// apps/cms/src/bootstrap/seed-easter.ts
// All video findOrCreate happens FIRST (non-destructive)
// Delete happens immediately before create (minimizes blank-page window)
if (existing)
  await experienceService.delete({ documentId: existing.documentId })

try {
  await experienceService.create({ data: fullExperience })
} catch (createError) {
  // Restore minimal placeholder so page shows something
  try {
    await experienceService.create({
      data: { slug: "easter", blocks: [heroBlock] },
    })
  } catch (placeholderError) {
    strapi.log.error("Placeholder restore also failed", placeholderError)
  }
  throw createError // Always propagate original error
}
```

### Trigger command

```bash
curl -X POST https://<cms-host>/api/seed-easter/trigger \
  -H "x-snapshot-secret: $DATA_SNAPSHOT_SECRET"

# Poll status
curl https://<cms-host>/api/seed-easter/status \
  -H "x-snapshot-secret: $DATA_SNAPSHOT_SECRET"
```

## Why This Works

1. **Fire-and-forget avoids HTTP timeouts**: The seed creates ~15 videos and a large experience with ~13 blocks. Synchronous await would exceed Railway/Cloudflare timeouts.
2. **Concurrency guard prevents duplicate seeds**: Module-level state prevents overlapping runs that could cause unique constraint violations.
3. **Delete-right-before-create minimizes the gap**: All slow video lookups happen before the destructive delete. The gap between delete and create is milliseconds.
4. **Placeholder fallback preserves availability**: If the full create fails, a minimal experience with the hero block is restored so the page shows something.
5. **Secret-auth reuse**: No new auth infrastructure needed. The existing `api::data-snapshot.secret-auth` middleware validates `x-snapshot-secret`.

## Prevention

1. **Orphaned seed functions are invisible failures**: Any bootstrap seed function that exists but is not called from `apps/cms/src/index.ts` should either be wired up or converted to an on-demand endpoint. Audit `apps/cms/src/bootstrap/` for unused exports.
2. **Add `experiences` to the data-snapshot allowlist** (`apps/cms/src/api/data-snapshot/services/snapshot-tables.ts`) so future snapshot restores include the easter experience.
3. **Post-deploy CI step**: Add the trigger curl to the Railway deploy pipeline so the easter experience is always present after a fresh deploy.
4. **When choosing between bootstrap vs endpoint**: Use bootstrap for config that must always be present and never changes (API tokens, webhooks, indexes). Use on-demand endpoints for content that editors may modify.

## Related Documentation

- [Strapi v5 Bootstrap Webhook Seeding](../cms/strapi-v5-bootstrap-webhook-seeding.md) -- simpler variant for synchronous, non-destructive seeds
- [CMS Database Snapshot Restore Automation](../platform/cms-database-snapshot-restore-automation.md) -- established the `secret-auth` middleware pattern and operational endpoint conventions
- [Strapi Enrichment Job Content Type](../cms/strapi-enrichment-job-content-type.md) -- alternative: persistent (DB-backed) job state vs ephemeral (in-memory) state used here
