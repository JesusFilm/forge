---
id: "feat-021"
title: "Generation Quality & Monitoring Dashboard"
owner: "ekkasit"
priority: "P2"
status: "not-started"
start_date: "2026-05-05"
duration: 21
depends_on:
  - "feat-013"
blocks:
  - "feat-059"
tags:
  - "manager"
---

## Entry Points — Read These First

1. `apps/manager/src/app/` — existing dashboard routes and pages
2. `apps/manager/src/app/api/jobs/` — existing job API routes
3. `apps/cms/src/api/enrichment-job/` — job tracking content type pattern

## Grep These

- `enrichment-job` in `apps/manager/` — how existing job status is displayed
- `JobStatus` in `apps/manager/src/types/job.ts` — status enum pattern

## What To Build

1. New dashboard page: `apps/manager/src/app/generation/page.tsx`
   - Table: topic clusters with status (pending, generating, draft, published, failed)
   - Stats: total topics, generated, pending, failed
   - Filter by status

2. Preview capability:
   - Click a generated topic → shows the Experience content in a read-only preview
   - Link to the actual web page: `{WEB_URL}/topic-{slug}/en`

3. Bulk actions:
   - "Publish all drafts" — bulk update from draft to published
   - "Regenerate failed" — re-queue failed clusters
   - "Export report" — CSV of generation results

## Constraints

- Follow existing dashboard patterns in `apps/manager/src/app/`. Do NOT introduce new UI frameworks.
- Do NOT build a full CMS editing UI. The preview is read-only. Editing happens in Strapi admin.

## Verification

- Navigate to `/generation` in manager app → page loads
- After running generation pipeline → table shows results with correct statuses
- Click "Publish all drafts" → Experiences change from draft to published in Strapi
- Click a topic → preview shows the generated content
