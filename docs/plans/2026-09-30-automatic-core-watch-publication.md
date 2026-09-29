---
title: "Automatically deliver Core imports and backfills to Watch"
type: fix
status: active
date: 2026-09-30
---

The user explicitly requests automatic search indexing and Watch manifests/cache
refresh after Core imports and backfills, plus verification of the recurring
import frequency. Continue the Breaking Point recovery in the existing isolated
worktree. Implement without changing the daily 07:00 UTC schedule.

## Design

Successful import/backfill -> durable coalesced delivery request -> worker builds
an immutable catalog snapshot -> atomic active-catalog reference -> regenerate
route/SEO manifests -> acknowledged Web invalidation. Failed delivery retries
independently from the import. No embeddings are generated for metadata changes.

Production's selected Candidate remains the reviewed search-engine baseline.
Automatic catalog refreshes are explicitly content publications, not new passing
relevance qualifications. Each refresh records the exact baseline, index/ranking
contract and shared transcript identity. Serving first validates the selected
baseline's existing qualification, then resolves its compatible active catalog.
Neither SERVING nor EVALUATION is repurposed. Switching the baseline or ranking
invalidates the refresh match; it never inherits unrelated approval. Keep old
physical collections immutable and protect active references from retirement.

Long Core phases must leave Workflow's HTTP execution path. Durable steps enqueue
or observe one phase execution and sleep while the dedicated worker performs it.
A database session lock serializes execution; a process crash releases that lock
and another worker resumes the same idempotent phase. A completed phase result
is reused on transport retries. Preserve Core ownership, successful-parent
watermark caps, full-import deletion guards, scope ordering and progress logs.

## Implementation units

1. **Import execution:** durable phase queue, native worker recovery, bounded
   Workflow polling, keep the full CLI path. Characterize/retest scheduled,
   incremental, full and failed runs. Verify no duplicate phase writer and no
   early watermark advancement. Reconcile new parent/child links after the
   final video page so a first import does not need a second pass.
2. **Catalog publication:** coalesced request counters and worker, exact baseline
   identity, reuse the existing validated Candidate builder without moving
   EVALUATION, activate only complete snapshots, preserve old serving data on
   failure, bound retained generations. Test failures before/after publication,
   retries, no-op digests, concurrent requests and baseline changes.
3. **Watch delivery:** queue after successful relevant import phases and executed
   metadata/relation backfills; never on dry runs or failed imports. Regenerate
   manifests and inspect webhook outcomes; retry missing configuration and
   failed HTTP responses. Wire worker Web credentials through normal release
   configuration. Verify late dubs update parent-series availability.
4. **Verification/release:** meaningful unit and real-database integration tests,
   existing Core/backfill regression suites, format/lint/type checks, adversarial
   review. Use normal PR-to-main deployments. Verify actual canonical-origin
   public search and Watch UI, not only private evaluation or HTTP status.

## Assumptions and limits

"Core importer" means Forge's importer reading published Core data; this work
does not change Core's upstream editorial/upload schedules. "Webbox" refers to
the existing Web revalidation webhook. Catalog refresh is authorized as normal
content delivery; schema/ranking/embedding changes retain existing review gates.
Do not claim that a content refresh passes the prior failed broad quality gate.

## Acceptance

A new published video and a new playable episode imported in one run appear in
live search, the series route, and regenerated manifests without an operator
reindex or redeploy per upload. Full/scoped backfills use the same delivery path.
Failure is visible and retryable; an incomplete build cannot replace serving
collections. Production schedule evidence and remaining limits are documented.
