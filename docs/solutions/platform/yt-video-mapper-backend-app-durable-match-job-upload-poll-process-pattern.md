---
title: "yt-video-mapper backend app durable match job upload poll process pattern"
date: 2026-06-09
last_updated: 2026-07-02
category: platform
module: apps/yt-video-mapper-backend
problem_type: architecture_pattern
component: background_job
severity: medium
applies_when:
  - "Creating a backend app that accepts raw media uploads and processes them asynchronously"
  - "A prototype needs durable job state before workers, retries, or polling can be trusted"
  - "Multimodal matching needs a canonical source identity plus a variant-level match"
  - "Public results should stay small while diagnostic evidence remains internal"
tags:
  - yt-video-mapper
  - prisma
  - background-job
  - raw-upload
  - polling
  - worker-drain
  - fusion-scoring
  - bearer-auth
related_components:
  - database
  - service_object
  - authentication
  - tooling
---

# yt-video-mapper backend app durable match job upload poll process pattern

## Context

The video mapper prototype accepts a downloaded external video and maps it back
to the original Core-sourced video used for analytics attribution. The answer is
not just "some Forge video row": callers need ranked candidates shaped as
`coreId`, `videoVariantId`, `confidence`, and `matchStrength`, where `coreId`
comes from Forge `Video.coreId` and `videoVariantId` comes from Forge
`VideoDub.coreId`.

The first backend slice therefore has to be more than a synchronous demo route.
Video processing is slow, large, and probabilistic; the app needs durable job
state, a transient upload location, an autonomous worker with an operator drain
fallback, and internal evidence storage before the real visual/audio/text
matchers are swapped in.

## Guidance

Build the app around an async upload job lifecycle:

1. `POST /match-jobs` accepts raw media bytes or `multipart/form-data` with a
   file/media part, stores the normalized upload bytes, creates a queued
   `MatchJob`, and returns `202` with `{ jobId, status }`.
2. `GET /match-jobs/:jobId` polls job state. Once complete, it returns
   `{ jobId, status: "complete", candidates }` so status-based pollers can
   terminate even when the candidate list is empty.
3. The server starts a bounded worker loop by default. The loop claims the
   oldest fresh queued or stale-running job, processes one job at a time, and
   polls when the queue is empty.
4. `POST /match-jobs/:jobId/process` remains available for authenticated
   operator recovery of a specific job. Tests and operator sessions can disable
   the background loop when deterministic control is needed.
5. A separate Match Job Cleaner runs every minute and expires queued jobs that
   have remained unclaimed for 30 minutes. Polling an expired job returns
   `{ jobId, status: "expired", errorCode: "job_expired" }`.
   `MATCH_JOB_CLEANER_ENABLED=false` can stop cleaner startup during rollout or
   incident response without changing the fixed expiry policy.

Use a Prisma-backed repository as the production default and keep in-memory
repositories test-only. Both the manual process path and the worker path should
share the same atomic claim semantics and recover stale running jobs:

```typescript
await db.matchJob.updateMany({
  where: {
    id: jobId,
    OR: [
      { status: "QUEUED" },
      { status: "RUNNING", startedAt: { lte: staleStartedBefore } },
    ],
  },
  data: { status: "RUNNING", startedAt, safeErrorCode: null },
})
```

Treat uploaded files as transient job inputs, not durable evidence artifacts.
Store the upload before creating the job, clean it up if job creation fails, and
clean it up again when processing reaches a terminal state. For abandoned
queued jobs, mark the job `expired` before deleting the upload, then clear the
upload fields only after deletion succeeds so retry cleanup can find leftovers.
Keep a retention timestamp on the job result so a later reaper can remove old
rows.

Coordinate cleaner passes across service instances with an owner-scoped
database lease. A cleaner that outlives its lease must not be able to release a
successor cleaner's lease, and expired-upload retry work should be bounded per
tick so old cleanup debt cannot starve newly overdue queued jobs.

Keep the catalog identity model explicit:

```text
CatalogVideo.coreId      -> canonical source video answer
CatalogVariant.coreId    -> parent source video
CatalogVariant.videoVariantId -> matched Core videoVariant.id
```

Candidate and signature rows should reference variants by the composite
`coreId + videoVariantId`, not by variant alone. This prevents evidence for one
Core video from being attached to a same-named or drifted variant identity.

Keep evidence internal. `MatchEvidence` can store visual, audio, text, duration,
and fusion details for review, but the public response should remain:

```json
{
  "candidates": [
    {
      "coreId": "core-video-id",
      "videoVariantId": "core-video-variant-id",
      "confidence": 0.913,
      "matchStrength": "high"
    }
  ]
}
```

For retrieval, avoid a metadata-first RAG shape. The useful primitive is a media
signature retrieval layer over official variants, followed by fusion. The
prototype has placeholder retrievers, but the seam should already model visual,
audio, text, and duration signals and merge by `coreId + videoVariantId`:

```typescript
const key = `${signal.coreId}:${signal.videoVariantId}`
```

Fuse multimodal evidence with visual as the source-video anchor and audio/text
as variant-ranking evidence. Normalize by available signals so sparse evidence
does not get unfairly penalized, but cap non-visual or weak-visual candidates
below high confidence. In the prototype, a candidate without a strong visual
anchor cannot exceed `0.84`, keeping `matchStrength: "high"` reserved for cases
with source-video support.

## Why This Matters

Analytics attribution needs the canonical Core video identity and the likely
variant identity. Returning only a source video can lose language or dub
information; returning only a variant can make the source attribution harder for
callers to use.

Durable async state prevents the usual prototype failure mode where a large
upload either blocks the HTTP request until it times out or disappears if the
process restarts. The autonomous worker prevents the subtler production failure
where `/health` passes and job creation returns `202`, but every submission sits
in `queued` forever because no consumer is running. The manual drain endpoint
still gives operators a targeted recovery tool without making the public API
list or mutate the whole queue.

The cleaner closes the other queue-health gap: an upload can be accepted and
then forgotten by both the caller and the operator. Expiring queued-only jobs
protects storage while keeping a pollable terminal answer for known job IDs.
The worker should skip queued jobs that have crossed the expiry window so
rollout backlogs are cleaned up instead of unexpectedly processed.

Keeping evidence internal lets the team inspect and tune the matcher without
committing every diagnostic detail to the public API. That matters for future
fusion work, because visual and audio evidence can disagree: visual should
usually decide the source video, while audio and transcript evidence should help
choose the best variant.

## When to Apply

- A backend app accepts uploaded files that need slower processing before a
  result can be returned.
- The public API needs ranked candidates, not a single irreversible best guess.
- A matcher needs both parent identity and variant identity.
- The app needs a prototype path before the real queue, catalog sync, and media
  indexing workers are complete.
- A durable local queue needs abandoned-upload cleanup without tying cleanup to
  client polling.
- Evidence is valuable for debugging but should not be exposed to callers yet.

## Examples

Good route shape:

```text
POST /match-jobs                  -> 202 { jobId, status }
worker loop                       -> claims fresh queued/stale-running jobs
cleaner loop                      -> expires queued jobs after 30 minutes
MATCH_JOB_CLEANER_ENABLED=false   -> rollout kill switch for cleaner startup
POST /match-jobs/:jobId/process   -> authenticated operator recovery
GET  /match-jobs/:jobId           -> queued/running/failed/expired envelope
GET  /match-jobs/:jobId           -> { jobId, status: "complete", candidates }
```

Avoid these shortcuts:

- Defaulting production runtime to an in-memory repository.
- Shipping durable queued jobs without an autonomous consumer or an explicit
  operator drain plan.
- Deleting raw uploads before a conditional queued-to-expired transition wins.
- Letting the worker auto-claim jobs that have already crossed the queued
  expiry threshold.
- Releasing a database cleaner lease without checking the lease owner.
- Retrying every expired upload cleanup before marking newly overdue queued
  jobs expired.
- Returning a candidate-only complete payload that makes empty no-match jobs
  ambiguous to status-based polling clients.
- Keying fusion by `videoVariantId` without the parent `coreId`.
- Exposing internal visual/audio/text evidence in the public response before
  the API contract calls for it.
- Treating title or metadata search as the foundation for matching reuploads.

Prototype caveats to address before large-scale operation:

- The raw upload route currently buffers the request body before storage;
  streaming upload storage is the next hardening step for large files.
- `retentionExpiresAt` is recorded, but a row-retention reaper still needs to
  delete old complete, failed, and expired job rows.
- Bearer-token access protects the service surface, but per-caller job
  ownership is not yet modeled.
- Catalog sync, media signature indexing, and labeled evaluation data still need
  to be built before confidence thresholds should be trusted operationally.

## Related

- [Adding a New App to the Forge Monorepo](./adding-new-apps.md)
- [New App CI & Deployment Patterns](./new-app-ci-and-deployment-patterns.md)
- [Local embed pipeline + manager-trigger parity pattern](./local-embed-pipeline-pattern-20260429.md)
- [Backfill Worker Pattern - Next.js Manager with CMS Queue](./backfill-worker-pattern-manager-20260407.md)
- [Admin manager enrichment trigger endpoint](./admin-manager-enrichment-trigger-endpoint-20260506.md)
- [Admin semantic-video retrieval is transcript-backed after feat-192](../architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md)
- [Optional Railway S3 with local fallback storage](./optional-railway-s3-local-fallback.md)
- [Composing N-way RRF safely with heterogeneous content types](../best-practices/rrf-fusion-heterogeneous-content-types-20260415.md)
- [In-memory slot reservation for fire-and-forget routes](../best-practices/in-memory-slot-reservation-fire-and-forget-20260506.md)
