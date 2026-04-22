---
title: "Strapi v5: Use numeric entity IDs for relations inside nested components"
date: 2026-03-31
problem_type: integration_issue
component: database
root_cause: wrong_api
resolution_type: seed_data_update
severity: high
module: apps/cms
tags:
  - cms
  - strapi
  - document-service
  - dynamic-zones
  - relations
  - components
  - seed
upstream_issues:
  - "strapi/strapi#22611"
  - "strapi/strapi#24850"
  - "strapi/strapi#23909"
affected_files:
  - apps/cms/src/bootstrap/seed-easter.ts
related:
  - docs/solutions/runtime-errors/cms-easter-seed-not-called-2026-03-30.md
  - docs/solutions/integration-issues/strapi-v5-manytone-relation-clearing.md
  - docs/solutions/cms/strapi-v5-bootstrap-webhook-seeding.md
github_prs:
  - "#584"
  - "#587"
  - "#588"
  - "#590"
---

## Problem

Strapi v5 Document Service `create()` fails with "Invalid relations" when a document contains manyToOne relation fields inside components within dynamic zones. This affects any programmatic content creation (seeds, sync scripts, lifecycle hooks) that builds documents with nested component relations.

## Symptoms

- `strapi.documents('api::X.X').create()` throws `"Invalid relations"`
- Affects relation fields inside components at **any nesting depth** within dynamic zones
- The error is thrown by the entity validator before any data reaches the database
- No indication of _which_ relation is invalid — the error message is generic

## What Didn't Work

1. **Plain `documentId` strings** (`video: someDoc.documentId`) — The entity validator cannot resolve documentId strings inside components.

2. **`{ connect: [documentId] }` syntax** — Works for some direct dynamic zone components but fails for repeatable component items and deeper nesting. Inconsistent behavior depending on nesting depth.

3. **Mixed approach** (connect for direct components, plain strings for nested) — Still fails because the validator rejects documentId-based references at any component depth.

4. **`{ documentId: "..." }` object format** — Confirmed broken per strapi/strapi#24850. Returns `Invalid id, expected a string or integer, got [object Object]`.

## Solution

Use **numeric entity IDs** (the raw database `id` column) for all relation fields inside components. Resolve the ID via direct Knex query, bypassing the Document Service entirely for lookups.

### Before (broken)

```typescript
async function findOrCreatePublishedVideo(strapi, slug, title) {
  const videoService = strapi.documents("api::video.video")
  const doc = await videoService.findFirst({
    locale: "en",
    status: "published",
    filters: { slug },
  })
  if (doc) return doc
  return await videoService.create({ data: { title, slug } })
}

// In component data:
video: someVideo.documentId // plain string — FAILS
video: {
  connect: [someVideo.documentId]
} // connect syntax — FAILS at depth
```

### After (working)

```typescript
async function findPublishedVideo(strapi, slug) {
  const knex = (strapi.db as any).connection
  const row = await knex("videos")
    .select("id", "document_id as documentId", "title", "slug")
    .where("slug", slug)
    .whereNotNull("published_at")
    .first()
  if (!row) throw new Error(`Video "${slug}" not found`)
  return row
}

// In component data — use numeric id everywhere:
video: someVideo.id // numeric DB row ID — WORKS at any depth
```

### Diagnostic technique

When debugging "Invalid relations" in complex dynamic zones, create the document with blocks incrementally to isolate which block fails:

```typescript
for (let i = 0; i < allBlocks.length; i++) {
  const subset = allBlocks.slice(0, i + 1).map((b) => b.data)
  // Delete previous attempt
  const prev = await service.findFirst({ filters: { slug } })
  if (prev) await service.delete({ documentId: prev.documentId })
  try {
    await service.create({ data: { slug, blocks: subset } })
    strapi.log.info(`Block ${i} (${allBlocks[i].name}) OK`)
  } catch (err) {
    strapi.log.error(`Block ${i} (${allBlocks[i].name}) FAILED: ${err.message}`)
    strapi.log.error(
      `Failing data: ${JSON.stringify(allBlocks[i].data).slice(0, 500)}`,
    )
    throw err
  }
}
```

## Why This Works

Strapi v5's Document Service has **two separate relation traversal implementations** that disagree:

1. **`transformData`** (in `@strapi/core/.../transform/relations/`) — normalizes relation formats using `traverseEntity` from `@strapi/utils`. Correctly handles all nesting depths.

2. **`buildRelationsStore`** (in `@strapi/core/.../entity-validator/`) — validates relations using its own independent recursive function. Fails to resolve `documentId` strings inside components within dynamic zones.

When you pass a numeric entity ID, the validator's `buildRelationsStore` looks it up directly with `WHERE id IN (...)` — no documentId resolution needed. This bypasses the buggy code path entirely.

This is a **confirmed open bug** in Strapi:

- strapi/strapi#22611 — "Cannot update relation with documentId in object"
- strapi/strapi#24850 — "DocumentService: No relation allowed for connect by documentId"
- strapi/strapi#23909 — "Some of the provided components are not related to the entity"

## Prevention

1. **Always use numeric entity IDs for relations inside Strapi v5 components.** This applies to seeds, sync scripts, lifecycle hooks — any code that calls `strapi.documents().create()` or `.update()` with component data containing relations.

2. **Never create content in seeds that should come from sync.** Look up existing records by slug instead. Seeds should be idempotent consumers of existing data, not producers.

3. **Test seed scripts against production data before relying on them.** The expanded easter seed (13 blocks) was written but never tested — the bug was only discovered when it was first run against production.

4. **Monitor upstream Strapi fixes.** When strapi/strapi#22611 is resolved, revert to documentId-based syntax to stay aligned with the Document Service API contract. Using numeric IDs is a workaround, not a permanent solution.

## Related Documentation

- [CMS Easter Seed Not Called](../runtime-errors/cms-easter-seed-not-called-2026-03-30.md) — the first part of this problem (seed function existed but was never invoked)
- [Strapi v5 ManyToOne Relation Clearing](strapi-v5-manytone-relation-clearing.md) — related: covers `undefined` vs `null` vs `{ set: [] }` semantics for relation fields, but does not cover the nested component bug
- [Strapi v5 Bootstrap Webhook Seeding](../cms/strapi-v5-bootstrap-webhook-seeding.md) — bootstrap lifecycle seeding patterns
