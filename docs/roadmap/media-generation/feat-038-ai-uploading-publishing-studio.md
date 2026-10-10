---
id: "feat-038"
title: "AI Uploading and Publishing Studio"
owner: "vlad"
priority: "P0"
status: "not-started"
start_date: "2026-05-05"
duration: 28
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "publishing"
---

## Problem

Upload, enrichment, editing, and publishing currently live in separate manual steps. The manager app needs a single studio flow that starts from raw media, uses AI to propose structure and metadata, lets an operator edit the package visually, and then publishes to internal and external destinations with explicit approval.

## Entry Points — Read These First

1. `apps/manager/src/app/dashboard/jobs/new-job-form.tsx` — current job creation and upload flow
2. `apps/manager/src/app/api/jobs/route.ts` — upload-backed job creation endpoint
3. `apps/manager/src/app/api/enrich/route.ts` — enrich existing CMS videos flow
4. `apps/manager/src/services/mux.ts` — asset creation and playback bootstrap
5. `apps/manager/src/services/metadata.ts`, `apps/manager/src/services/translation.ts`, `apps/manager/src/services/chapters.ts` — existing AI suggestion patterns

## Grep These

- `new-job-form|createMuxAsset` in `apps/manager/src/`
- `uploadMux|generateVoiceover|languages` in `apps/manager/src/types/job.ts`
- `chat.completions.create` in `apps/manager/src/services/`

## What To Build

1. New route: `apps/manager/src/app/dashboard/studio/new/page.tsx`
   - Start from file upload, external URL, or existing Mux asset.
2. Studio orchestration layer:
   - Auto-propose title, description, topics, chapters, target languages, caption/voiceover settings, and publish destinations.
3. Visual editing surface:
   - WYSIWYG preview/editor for the generated video page package before publish approval.
4. Publishing layer:
   - Approve and push to manager-owned delivery targets.
   - Queue YouTube publishing as an auditable browser-agent job.
5. Re-entry support:
   - Open an existing asset back in the studio to revise and republish it.

## Constraints

- Do NOT replace Strapi admin with a full general-purpose editor.
- Human approval is required before external publishing.
- Keep the studio grounded in existing manager APIs and workflow jobs instead of inventing a second orchestration stack.

## Verification

- A user can upload a new asset and receive an AI-proposed package in one flow.
- The generated package can be edited visually before approval.
- Approving publish creates the expected internal output and records a publish job for YouTube when requested.
- Reopening an existing asset in the studio preserves prior metadata and publish state.
