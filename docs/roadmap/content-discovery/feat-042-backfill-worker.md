---
id: "feat-042"
title: "Video Vectorization — Phase 1 Backfill Worker (en/es/fr)"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-05-18"
duration: 10
depends_on:
  - "feat-038"
  - "feat-040"
  - "feat-041"
blocks:
  - "feat-044"
  - "feat-045"
tags:
  - "manager"
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The English, Spanish, and French video catalog needs to be processed through the scene vectorization pipeline (boundaries → descriptions → embeddings → indexing). Processing runs once per unique Video entity (not per variant). This is a one-time batch job that must be resumable, cost-tracked, and safe to run against production.

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

1. **Fetches Phase 1 video queue** — all unique Videos with en/es/fr variants, ordered by label (feature films first for early quality signal). Dedup: process each Video once regardless of how many language variants it has.
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
- Phase 1 languages only (en, es, fr): filter by language throughout
- Process once per Video entity, store `language` column as the transcript language used for description

## Verification

- Dry-run mode reports accurate cost estimate for full en/es/fr catalog
- Process 100 videos end-to-end → embeddings appear in `scene_embeddings`
- Kill worker mid-batch, restart → picks up where it left off
- Cost tracking matches actual API billing within 10%
- `SELECT COUNT(*) FROM scene_embeddings WHERE language IN ('en', 'es', 'fr')` grows as expected
- No duplicate processing: a Video with en+es+fr variants is processed once
