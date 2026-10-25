---
id: "feat-015"
title: "Bulk Experience Write API"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: "2026-04-23"
duration: 21
depends_on:
  - "feat-003"
blocks:
  - "feat-013"
tags:
  - "cms"
---

## Entry Points — Read These First

1. `apps/cms/src/api/core-sync/services/` — bulk upsert patterns. Grep for `temp_` to find the temp table approach.
2. `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience schema with `sections` dynamic zone
3. `apps/cms/schema.graphql` — search for `ExperienceInput` or `ExperienceSectionsItemsDynamicZone` to understand the dynamic zone input shape
4. `apps/cms/src/components/sections/` — list this directory to see all section component schemas

## Grep These

- `bulkUpsert|bulk_upsert|temp_` in `apps/cms/src/api/core-sync/` — existing bulk write patterns
- `dynamiczone` in `apps/cms/src/api/experience/` — sections field definition
- `components__` or `_components` in SQL queries within `apps/cms/` — how Strapi stores dynamic zone data in DB

## What To Build

1. Custom controller: `apps/cms/src/api/experience/controllers/bulk.ts`

   ```typescript
   // POST /api/experiences/bulk
   export async function bulkCreate(ctx: Context) {
     const { experiences } = ctx.request.body as {
       experiences: Array<{
         slug: string // unique key for upsert
         title: string
         metaDescription?: string
         ogTitle?: string
         ogDescription?: string
         sections: Array<{
           __component: string // e.g. "sections.video-hero"
           [key: string]: unknown
         }>
         topicSlug?: string // link to Topic after creation
         publishedAt?: null // null = draft
       }>
     }
   }
   ```

2. Implementation approach:
   - For each experience in the batch:
     - Check if slug exists → update or create
     - Use `strapi.entityService.create('api::experience.experience', { data })` for creates
     - Use `strapi.entityService.update('api::experience.experience', id, { data })` for updates
   - Dynamic zones are handled natively by `entityService` — pass the `sections` array as-is
   - If `topicSlug` provided, link the created Experience to the Topic via relation update
   - Return: `{ created: number, updated: number, failed: Array<{ slug: string, error: string }> }`

3. Register the custom route in `apps/cms/src/api/experience/routes/bulk.ts`:

   ```typescript
   export default {
     routes: [
       {
         method: "POST",
         path: "/experiences/bulk",
         handler: "bulk.bulkCreate",
         config: { auth: { scope: ["api::experience.experience.create"] } },
       },
     ],
   }
   ```

4. If `entityService` is too slow for thousands of records, fall back to the raw SQL temp table pattern from core-sync. But try `entityService` first — it handles dynamic zones correctly.

## Constraints

- Do NOT bypass Strapi's dynamic zone handling. Dynamic zones have complex DB storage (multiple join tables per component type). Let `entityService` handle it unless performance requires otherwise.
- All created Experiences start as drafts (`publishedAt: null`). The generation pipeline must NOT auto-publish.
- Batch size limit: accept max 100 per request. Ekkasit's pipeline will call in batches.
- Require admin API token authentication — this is not a public endpoint.

## Verification

- POST 5 Experiences with sections → all 5 created in Strapi with correct dynamic zone data
- POST same 5 slugs again with different title → existing records updated, not duplicated
- Query one created Experience via GraphQL with full section population → all blocks resolve
- Load a created Experience on the web app → renders correctly
- POST 100 Experiences → completes in < 60 seconds
