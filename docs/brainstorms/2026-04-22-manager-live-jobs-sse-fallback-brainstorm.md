---
date: 2026-04-22
topic: manager-live-jobs-sse-fallback
related:
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/roadmap/media-generation/feat-087-manager-enrichment-ux.md
  - docs/plans/2026-04-13-fix-enrich-now-feedback-plan.md
  - docs/brainstorms/2026-04-11-enrich-now-feedback-brainstorm.md
  - docs/solutions/integration-issues/manager-job-read-model-source-language-metadata-20260409.md
---

# Manager Live Jobs via SSE + Polling Fallback

## What We're Building

Make the Manager jobs list and single-job detail pages feel truly live across
multiple open screens, not just eventually refreshed by interval polling.

The target behavior is shared realtime job progress: if one browser starts a
job, retries a step, or watches a running enrichment complete, every other open
Manager jobs screen should update as soon as the job state changes. The jobs
list remains the overview surface, and job detail remains the source of truth
for step-by-step execution, but both should react to the same underlying job
events instead of waiting for their next poll cycle.

## Why This Approach

We considered three directions:

1. Keep improving polling. This is the smallest technical change, but it does
   not satisfy the chosen goal of shared multi-user realtime updates.
2. Add WebSockets. This would support realtime updates, but it adds more
   connection and infrastructure surface than this use case needs because the
   server only needs to push job-state changes to clients.
3. Add server-sent events with polling fallback. This gives one-way push
   updates that match the product need, keeps the browser integration simple,
   and lets the current polling path remain as the recovery path when streams
   disconnect or realtime transport is unavailable.

Recommendation: use SSE for the primary live transport and keep the existing
polling path as an explicit fallback. That is the smallest honest design that
achieves shared realtime behavior without pretending interval refresh is the
same thing.

## Key Decisions

- Shared multi-user updates are the goal, not just faster refresh in one tab.
- The jobs list and job detail page should react to the same job-change stream.
- SSE is the preferred transport for Manager job updates.
- Existing polling stays in the product as fallback and reconciling recovery,
  not as the primary live path.
- The backend event source should be tied to durable job-state changes rather
  than to individual UI actions so locally started jobs and externally triggered
  state changes produce the same visible truth.
- Operators should still see coherent status after reconnects, missed events,
  or tab backgrounding by reconciling with the normal jobs APIs.
- This work is about live state delivery, not a broader redesign of Jobs page
  information architecture or workflow-step semantics.

## Resolved Questions

- The desired outcome is true shared realtime across open Manager screens.
- The primary transport should be SSE, not WebSockets.
- Polling should remain as a fallback rather than being removed completely.
- The scope includes both the jobs list and the single-job detail experience.
- Multi-user consistency matters more than micro-optimizing local perceived
  responsiveness after a single operator action.

## Open Questions

None.

## Next Steps

Proceed to planning for a Manager jobs live-update feature centered on SSE plus
polling fallback, with careful attention to how `src/lib/state.ts` publishes
job changes and how list/detail consumers resubscribe or reconcile after missed
events.
