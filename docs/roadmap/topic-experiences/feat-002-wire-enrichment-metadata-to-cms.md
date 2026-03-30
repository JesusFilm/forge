---
id: "feat-002"
title: "Wire Enrichment Metadata Back to CMS"
owner: "vlad"
priority: "P0"
status: "not-started"
timeline: "Week 1-2"
depends_on: []
blocks:
  - "feat-007"
  - "feat-009"
tags:
  - "cms"
  - "manager"
  - "ai-pipeline"
---

## Problem

The enrichment pipeline stores metadata as S3 artifacts. This data never reaches the CMS, so it can't power search, filtering, or topic generation.

## Entry Points — Read These First

1. `apps/manager/src/services/metadata.ts` — `generateMetadata()` returns `VideoMetadata` with `topics: string[]`, `tags: string[]`, `speakers: string[]`
2. `apps/manager/src/services/storage.ts` — `uploadArtifact()` / `downloadArtifact()` for S3 read/write
3. `apps/manager/src/workflows/videoEnrichment.ts` — durable workflow, add a new step here
4. `apps/cms/src/api/keyword/content-types/keyword/schema.json` — Keyword content type with `source` enum (`"core"` | `"manager"`)
5. `apps/cms/src/api/video/content-types/video/schema.json` — Video content type, target for new relations

## Grep These

- `WorkflowStepName` in `apps/manager/src/types/job.ts` — enum of pipeline steps, add `"metadataSync"` here
- `source.*enum` in `apps/cms/src/api/keyword/` — existing `"core" | "manager"` pattern to follow
- `generateMetadata` in `apps/manager/src/services/metadata.ts` — returns the `VideoMetadata` type to consume

## What To Build

1. New function in `apps/manager/src/services/metadata.ts`:

   ```typescript
   async function syncMetadataToCms(
     assetId: string,
     metadata: VideoMetadata,
   ): Promise<void>
   ```

   - Read `metadata.json` artifact from S3
   - For each item in `metadata.tags[]`: find-or-create Keyword with `source: "manager"`, link to Video
   - For each item in `metadata.topics[]`: find-or-create Keyword with `source: "manager"` and a new `type: "topic"` field, link to Video
   - For each item in `metadata.speakers[]`: store on Video (add `speakers` JSON field or relation)
   - Use Strapi REST API (`POST /api/keywords`, `PUT /api/videos/:id`) with admin API token

2. New workflow step in `videoEnrichment.ts` — runs after metadata extraction step

3. Add `type` enum field to Keyword content type: `"keyword" | "topic" | "speaker"` (extends the existing schema)

## Constraints

- Do NOT create separate content types for topics/speakers yet — extend Keyword with a `type` discriminator. Nisal will create a dedicated Topic type later that references these.
- Do NOT modify the enrichment workflow's existing steps. Add a new step after them.
- Upsert, not insert — re-enriching a video must update, not duplicate.
- Use the admin API token pattern from `apps/manager/src/lib/auth.ts`.

## Verification

- Run enrichment on a test video, then query Strapi: `GET /api/keywords?filters[source]=manager` returns AI-generated keywords
- Query `GET /api/videos/:id?populate=keywords` shows linked keywords
- Re-run enrichment on same video — keyword count should not increase

## Success Criteria

- After enrichment, Video records in Strapi have populated keyword relations with `source: "manager"`
- Keywords are typed (`"keyword"`, `"topic"`, `"speaker"`)
- Re-enrichment is idempotent
