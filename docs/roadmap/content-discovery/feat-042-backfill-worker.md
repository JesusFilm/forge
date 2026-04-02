---
id: "feat-042"
title: "Video Vectorization — English Backfill Worker"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-05-18"
duration: 10
depends_on:
  - "feat-038"
  - "feat-040"
  - "feat-041"
blocks:
  - "feat-044"
tags:
  - "manager"
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The full English video catalog needs to be processed through the scene vectorization pipeline (boundaries → descriptions → embeddings → indexing). This is a one-time batch job that must be resumable, cost-tracked, and safe to run against production.

## Entry Points — Read These First

1. `apps/manager/src/workflows/videoEnrichment.ts` — existing workflow pattern
2. `apps/manager/src/services/sceneBoundaries.ts` — scene boundary extraction (feat-039)
3. `apps/manager/src/services/sceneDescription.ts` — scene description generation (feat-040)
4. `apps/cms/src/api/scene-embedding/services/indexer.ts` — embedding indexer (feat-041)
5. `apps/manager/railway.toml` — Railway service configuration

## Grep These

- `restartPolicyType` in `apps/manager/` — Railway restart configuration
- `enrichment-job` in `apps/cms/src/api/` — job tracking pattern

## What To Build

Dedicated entry point (separate Railway service or manager CLI command) that:

1. **Fetches English video queue** — all Videos with English variants, ordered by label (feature films first for early quality signal)
2. **Tracks progress** — store processed video IDs to resume on restart. Use enrichment job pattern or simple DB table.
3. **Per-video pipeline**: scene boundaries → scene descriptions → embed descriptions → index in pgvector
4. **Cost controls**:
   - Configurable batch size (default: 100 videos per run)
   - Rate limiting (requests per minute to LLM provider)
   - Cumulative cost tracking (log tokens used, compute running total)
   - Auto-pause at configurable cost threshold (default: $500)
5. **Dry-run mode** — process N videos through boundary extraction only, estimate total LLM cost without making calls
6. **Logging** — structured JSON logs: video ID, label, scene count, tokens used, cost, duration per video

## Constraints

- Must be resumable — crashing mid-batch loses no completed work
- Must not block the manager pipeline for new uploads
- Railway worker constraints: design as queue-based with configurable batch sizes rather than assuming infinite runtime
- English only: filter by language throughout

## Verification

- Dry-run mode reports accurate cost estimate for full English catalog
- Process 100 English videos end-to-end → embeddings appear in `scene_embeddings`
- Kill worker mid-batch, restart → picks up where it left off
- Cost tracking matches actual API billing within 10%
- `SELECT COUNT(*) FROM scene_embeddings WHERE language = 'en'` grows as expected
