---
id: "feat-013"
title: "Bulk Experience Generation Pipeline"
owner: "ekkasit"
priority: "P0"
status: "not-started"
start_date: "2026-04-14"
duration: 42
depends_on:
  - "feat-007"
  - "feat-008"
  - "feat-020"
  - "feat-015"
  - "feat-003"
blocks:
  - "feat-021"
  - "feat-017"
  - "feat-018"
  - "feat-059"
tags:
  - "manager"
  - "cms"
  - "ai-pipeline"
---

## Entry Points — Read These First

1. `apps/manager/src/workflows/videoEnrichment.ts` — durable workflow pattern with `"use workflow"` / `"use step"` directives. Follow this pattern for the generation workflow.
2. `apps/cms/src/api/enrichment-job/content-types/enrichment-job/schema.json` — job tracking pattern (status, steps, artifacts, errors)
3. `apps/manager/src/services/storage.ts` — S3 artifact storage
4. `apps/manager/src/lib/openrouter.ts` — shared LLM client
5. `apps/cms/src/api/core-sync/services/` — bulk upsert patterns if you need to write directly to DB

## Grep These

- `"use workflow"` in `apps/manager/` — durable execution directive
- `"use step"` in `apps/manager/` — individual step directive
- `uploadArtifact` in `apps/manager/src/services/storage.ts` — artifact write pattern
- `bulkUpsert` or `temp_` in `apps/cms/src/api/core-sync/` — bulk write SQL patterns

## What To Build

1. New file: `apps/manager/src/workflows/topicGeneration.ts`

   ```typescript
   // Durable workflow: generates Experiences for all topic clusters
   export async function topicGenerationWorkflow(options: {
     clusteringResultPath: string // S3 path to clustering-result.json
     dryRun?: boolean // generate but don't write to CMS
     batchSize?: number // default 50
   }): Promise<GenerationResult>
   ```

2. Pipeline steps (each is a durable step):
   - **Step 1: Load clusters** — read `clustering-result.json` from S3
   - **Step 2: For each cluster batch** (batches of `batchSize`):
     a. Select template (`selectTemplate(cluster)`)
     b. Call Vlad's content generation API (`POST /api/generate-topic-content`)
     c. Assemble full Experience object (merge template structure + generated content + video references)
     d. Write to Strapi via Nisal's bulk write API (`POST /api/bulk-experiences`)
     e. Create/update Topic record linking to the Experience
   - **Step 3: Generate summary** — total created, failed, skipped

3. New file: `apps/manager/src/services/experienceAssembler.ts`

   ```typescript
   export function assembleExperience(
     cluster: TopicCluster,
     template: ExperienceTemplate,
     generatedContent: GeneratedExperienceContent,
   ): StrapiExperienceCreatePayload
   ```

   Merges template structure + LLM-generated content + actual video IDs into a Strapi-writable payload.

4. API route: `POST /api/generate-topics` — triggers the workflow. Returns job ID for tracking.

## Constraints

- Do NOT call the LLM directly. Call Vlad's content generation API endpoint — separation of concerns.
- Do NOT write to Strapi one-at-a-time. Use Nisal's bulk write API in batches.
- All generated Experiences must have `draftAndPublish: true` and start as **drafts**. Never auto-publish.
- Rate limit LLM calls: max 10 concurrent requests to Vlad's content API.
- Pipeline MUST be resumable. If it crashes at cluster 500 of 5000, restarting should skip the first 500. Use the durable workflow pattern.
- Do NOT modify existing Experiences that were manually created (check for a `source` field or similar marker).

## Verification

- Run with `dryRun: true` on 10 clusters → logs what would be created, writes nothing to CMS
- Run on 10 clusters without dry run → 10 Experiences created in Strapi as drafts
- Query Strapi: `GET /api/experiences?filters[slug][$startsWith]=topic-` returns generated pages
- Generated Experiences render on web: visit `/topic-forgiveness/en` → page loads with sections
- Re-run on same clusters → updates existing, does not duplicate
- Run on 100 clusters → completes without timeout or memory issues

## Dependencies

- **Feature 1** (topic clusters) — input
- **Feature 2** (templates) — page structure
- **Vlad Feature 3** (content generation API) — LLM content
- **Nisal Feature 4** (bulk write API) — write path
