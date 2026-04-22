---
date: 2026-04-10
topic: scene-embeddings-from-enrichment-pipeline
related:
  - docs/roadmap/content-discovery/feat-045-pipeline-integration.md
  - docs/plans/2026-04-11-feat-integrate-scene-embeddings-into-enrichment-plan.md
---

# Scene Embeddings from Enrichment Pipeline

## What We're Building

Add scene embedding sync to the existing optional enrichment scene-analysis path so a completed enrichment job can produce CMS `scene_embeddings` from the transcript it just generated. This closes the gap where enrichment can already create scene analysis artifacts but stops short of indexing the scenes that power recommendations.

Keep `scene_embeddings` unchanged on the CMS side: rows still store numeric `video_id` and remain compatible with the current recommendation query model. The external manager-to-CMS boundary should accept `videoDocumentId`, then CMS resolves that to the published numeric video row before delete-and-replace indexing.

## Why This Approach

We considered three shapes:

- Shared manager sync service plus CMS `videoDocumentId` resolution
- Manager-side numeric ID resolution before CMS POST
- Rekeying `scene_embeddings` around `videoDocumentId`

The chosen approach is the first one. It keeps catalog backfill and enrichment as separate entry points, which still matches the real data sources, while extracting only the shared embed-and-index work. It also follows the existing transcript embedding sync pattern, where manager sends a stable document identifier and CMS owns the lookup to its internal row ID.

## Key Decisions

- Shared manager service: extract the embed-and-index logic from `apps/manager/src/services/sceneEmbedder.ts` into a reusable `sceneEmbeddingSync` service that both backfill and enrichment call.
- CMS boundary takes `videoDocumentId`: extend `/scene-embedding/index` so enrichment can target a video by `videoDocumentId` without learning Strapi numeric IDs.
- Keep numeric internal keying: do not change `scene_embeddings.video_id`; recommendation queries and relational joins already depend on numeric video IDs.
- Enrichment uses in-memory scene analysis: after `analyzeAllScenes()` succeeds in `videoEnrichment.ts`, call the shared sync service with the computed analysis result instead of re-reading artifacts.
- Overwrite on enrichment rerun: scene sync should replace existing rows for that video, not skip when rows already exist. Scene analysis output can legitimately change across reruns, and the current scene indexer already uses delete-and-reinsert semantics.
- Failure stays optional: a scene embedding sync failure should be recorded and logged, but it must not fail the overall enrichment job.

## Open Questions

- No product-level blockers remain for planning.
- Planning should decide the smallest useful sync report shape for job artifacts and job UI.
- Planning should confirm whether language gating belongs in enrichment wiring, shared sync, or both.

## Next Steps

Proceed to planning with Approach A and overwrite semantics as the chosen design.
