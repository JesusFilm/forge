---
title: "Harden a production recommendation slice at every irreversible boundary"
date: "2026-08-26"
last_updated: "2026-08-31"
category: "architecture-patterns"
module: "apps/admin and apps/web recommendations"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "A user-facing recommendation request has a fixed end-to-end response deadline"
  - "A new lifecycle model must deploy over databases restored from pre-final snapshots"
  - "Browser playback telemetry may retry, race navigation, or arrive after the active window"
  - "A hybrid personalization manifest is authorized only as a bounded, versioned experiment"
tags:
  - "recommendations"
  - "latency-budget"
  - "snapshot-repair"
  - "idempotent-telemetry"
  - "terminal-events"
  - "anonymous-profile"
  - "bounded-pilot"
  - "production-boundary"
related_components:
  - "database"
  - "frontend_stimulus"
  - "background_job"
  - "testing_framework"
---

# Harden a production recommendation slice at every irreversible boundary

## Context

A production recommendation feature is not one retrieval query. It crosses a
chain of boundaries: the response must finish on time, its durable trace must
agree with what Watch received, a selection must hand off short-lived playback
authority, retryable browser facts must converge on one lifecycle, restored
databases must accept the new model, and a personalized hybrid manifest must
not escape the evidence that authorized it.

The feat-368 slice made those boundaries explicit. The public delivery contract
remains `semantic-recommendation-v1`, the Watch surface remains
`watch-below-player-v1`, and the complete service budget remains exactly 1,500
ms (`apps/admin/src/services/recommendations/contracts.ts:3-24`). The returned
shape preserves the immutable experiment-assignment lane while separately
reporting whether the request executed semantic contextual retrieval or the
versioned semantic-plus-profile hybrid pipeline. A historic
`profile_challenger` assignment label is not itself execution truth and must
never be reinterpreted as a new manifest
(`apps/admin/src/services/recommendations/contracts.ts:66-83`).

Earlier reviews considered delivery, migrations, telemetry, and governance as
separate areas. That was insufficient: an individually correct component could
still leave an experiment-bound selection unverifiable, a restored snapshot
unmigratable, or a terminal outcome unable to supersede earlier evidence
(session history). Production readiness became a joint invariant proven by
real PostgreSQL, pgvector, Redis, and browser journeys rather than by isolated
happy paths.

This learning describes [PR #1976](https://github.com/JesusFilm/forge/pull/1976),
which is open and unmerged as of 2026-08-31.

## Guidance

Work backward from every irreversible boundary. Reserve, repair, deduplicate,
or fence all work that must precede it.

### Allocate the fixed response budget backward from issuance

Keep one public deadline and derive internal deadlines from it. Delivery
reserves time for candidate issuance, a cached eligibility recheck, and response
return (`apps/admin/src/services/recommendations/delivery.service.ts:88-99`).
Fresh retrieval receives the candidate budget; only after it fails may the
compatible cache spend its recheck reserve
(`apps/admin/src/services/recommendations/delivery.service.ts:246-321`). A
healthy warm request therefore does not launch duplicate database work.

Capability signing and response-size validation finish before any `ISSUED`
root is committed
(`apps/admin/src/services/recommendations/delivery-issuance.ts:28-129`).
The request, ordered items, candidate-stage evidence, personalization decision,
and delivery audit commit atomically
(`apps/admin/src/services/recommendations/delivery.service.ts:627-814`).

Bound the issuance transaction with the queue, transaction, and PostgreSQL
statement deadlines that own the commit. Do not put an outer `Promise.race`
around it: a JavaScript timeout can reject while the database later commits,
making Watch receive a timeout while Admin records success
(`apps/admin/src/services/recommendations/delivery.service.ts:291-321`). Race
only work whose losing result is cancelable or harmless.

### Repair schemas that really existed

Forward-only migrations must support databases restored from incomplete or
pre-final feature snapshots, not only a clean database that already has the
final shape.

- Migration 0066 idempotently adds the missing playback-finalization deadline
  and its recovery index.
- Migration 0067 replaces the historical submission-budget function with an
  episode-bound atomic budget.
- Migration 0068 replaces every retained raw trace actor with an independent
  random pseudonym before dropping the raw identifier. It deliberately loses
  legacy actor continuity instead of embedding an application secret in
  migration history.

The real repair test constructs those old table and function shapes directly,
then applies the repair SQL
(`apps/admin/src/services/recommendations/snapshot-repair.db.test.ts:22-107`).
It verifies the repaired index and function and proves that retained actor
digests are distinct, are not raw identifiers, and are not unsalted hashes of
those identifiers
(`apps/admin/src/services/recommendations/snapshot-repair.db.test.ts:116-193`).

### Treat playback telemetry as an idempotent terminal protocol

Watch assigns a stable event ID when each fact is created. Its sender drains
one batch at a time and keeps the same IDs and payloads after a failed post
(`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:49-62`,
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:189-238`).

A page-exit terminal is queued in order before the same event is attempted as a
keepalive fast path. The recorder reserves capacity for terminal truth and emits
at most one terminal across end, page hide, visibility loss, route exit, and
media failure
(`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:243-287`,
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:482-557`).

Admin decides replay versus conflict under the episode boundary. The same
episode/event identity with the same payload digest is a replay; a different
digest is quarantined without consuming another sequence number
(`apps/admin/src/services/recommendations/playback.service.ts:190-262`). New
facts receive one atomic sequence range, and terminal truth makes the episode
immediately due for finalization
(`apps/admin/src/services/recommendations/playback.service.ts:264-400`).

Finalization binds each immutable outcome revision to its fact watermark and
input digest. Equal inputs replay exactly, later watermarks append a monotonic
revision, and stale generations or lower watermarks cannot become current
(`apps/admin/src/services/recommendations/outcome.service.ts:278-410`).

### Make bounded hybrid personalization immutable by identity

The hybrid manifest is exact, not resemblance-based. Its identity fixes the
semantic and profile generators, canonical union, eligibility, ranker,
composer, delivery and surface contracts, slate bound, projection versions,
semantic fallback, service deadline, and learning source. The separate
experiment identity fixes bounded-live authority and exposure. Both generators
may nominate, but only consent-authorized profile input participates; an empty
or failed profile source is absence of signal, not a second semantic vote.
Semantic-only remains the control, fallback, kill-switch target, and
last-known-good strategy
(`apps/admin/src/services/recommendations/promotion/manifest.ts`).

Keep assignment and execution as separate immutable facts. The experiment arm
and legacy `profile_challenger` lane explain why the request was authorized and
how it is attributed. The manifest ID and `executionMode` explain what actually
ran. This preserves historic evidence while allowing an authorized challenger
to execute the exact `semantic-profile-hybrid-v1` pipeline.

Promotion checks pilot scope when a run is created and again after a workflow
claims it, before pointer mutation
(`apps/admin/src/services/recommendations/promotion/service.ts:172-227`,
`apps/admin/src/services/recommendations/promotion/service.ts:307-358`). The
exact bounded experiment rejects both an in-place exposure increase and a
permanent default; broader exposure requires a new versioned experiment
(`apps/admin/src/services/recommendations/promotion/service.ts:856-879`).
Rollback and emergency stop remain available.

### Preserve exact-six as a composition invariant

Do not let a consented profile source replace semantic availability. Preserve
the complete bounded semantic reserve before adding profile nominations; use
only the remaining 64-nomination capacity for profile candidates
(`apps/admin/src/services/recommendations/delivery-candidate-mapping.ts:37-61`).
A sparse, missing, or failed profile source is absence of influence. The
delivery request keeps its semantic slate and records `semantic_fallback`
instead of shrinking the result (`apps/admin/src/services/recommendations/delivery.service.ts:567-586`).

Separate hard eligibility from best-effort repetition preferences. The current
Video, locale/playability failures, and canonical duplicates remain hard
exclusions. Recent playback, selection, and repeated-serving signals are used
to choose every fresh item first, then become a deterministic reserve only for
positions that would otherwise be empty
(`apps/admin/src/services/recommendations/slate.ts:45-94`). This fills all six
positions when at least six unique eligible nominees exist without pretending
that a repeated item is invalid.
Each reused reserve item records `refill_after_suppression`, and the request
records `bounded_reserve_refill`, so Admin can distinguish a fresh position
from a controlled refill
(`apps/admin/src/services/recommendations/orchestration.ts:347-369`,
`apps/admin/src/services/recommendations/delivery.service.ts:528-533`).

Profile ranks must also be global within the profile generator before hybrid
ranking. Keep the per-interest rank as evidence, then assign one deterministic
`source_rank` across the bounded multi-interest result. The current query orders
by per-interest rank, session-before-durable kind, interest ordinal,
similarity, Video ID, and scene index
(`apps/admin/src/services/recommendations/candidates/profile-candidate.service.ts:511-568`).
This avoids several rank-one profile candidates entering source-relative
fusion with the same rank while preserving how each interest produced them.

## Why This Matters

Every boundary must tell the same truth about whether work happened. Internal
deadline reserves prevent a late successful commit from being reported as a
timeout. Historical-shape tests make upgrade support executable. Stable fact
identity makes browser retries converge instead of double-counting or losing
terminal truth. Immutable experiment identity prevents a small authorized
cohort from silently changing meaning after evidence starts accumulating.

Together these properties make one request fast, selectable, learnable,
privacy-safe, reversible, and explainable through the Admin trace. Proving only
one of them leaves the production slice internally inconsistent.

## When to Apply

- A fixed user-facing deadline contains several network or database phases.
- A durable commit cannot be safely canceled after its caller times out.
- A forward repair claims to support an already deployed or restored schema.
- Browser lifecycle events can retry, overlap, or arrive during navigation.
- A live personalization cohort is authorized more narrowly than the long-term
  product direction.

## Examples

The implementation protects the pattern with separate executable boundaries:

- Delivery tests prove one complete issuance, shared absolute deadlines, no
  cache recheck on healthy fresh retrieval, and no timeout reclassification
  after a successful commit
  (`apps/admin/src/services/recommendations/delivery.service.test.ts:431-697`).
- CI's PostgreSQL jobs cover clean migration, historical repair, real
  promotion, vector retrieval, and profile candidate retrieval; Redis jobs
  execute the actual admission Lua paths (`.github/workflows/ci.yml:97-202`).
- Playback tests cover duplicate terminals, pending-claim page exit, replay,
  conflict, bounded lateness, and monotonic outcome publication.
- Browser QA proves that essential-only and newly consented flows each receive
  six recommendations with loaded thumbnails.
  After consent, selection, and a qualified finalized playback publish profile
  generation 3, the traced follow-up request receives an exact-six
  `hybrid_personalized` slate with two interests in 800 ms. Its Admin evidence
  contains semantic and profile contributions without exposing a profile
  identifier, cookie, history, or vector.
- Candidate-platform coverage proves that six recent candidates become the
  final deterministic reserve while the current Video stays excluded and every
  reused item carries `refill_after_suppression`
  (`apps/admin/src/services/recommendations/candidate-platform.test.ts:486-530`).
- The real pgvector profile test proves that global profile source ranks are
  exactly `1..N` even when the first two nominations both retain per-interest
  rank one as evidence
  (`apps/admin/src/services/recommendations/candidates/profile-candidate.db.test.ts:417-453`).
- Admin evidence may contain repeated contributors from the same generator and
  version at different ranks. Trace rows therefore use rank and occurrence in
  their React identity; generator and version alone are not unique
  (`apps/admin/src/app/dashboard/recommendations/request-detail-candidate-evidence.tsx`).

The rejected shortcuts are equally important: do not increase the public
deadline, validate repair SQL only against the newest schema, send terminal
truth only as best-effort keepalive, or mutate the profile pilot's exposure
percentage in place.

## Related

- [Bounded semantic pgvector fan-out](../performance-issues/semantic-recommendation-retrieval-bounded-pgvector-fanout.md)
- [Forward-only Prisma migration history](../database-issues/prisma-migration-backed-revert-state-check.md)
- [Canonical server telemetry and supplemental browser context](canonical-server-search-analytics-supplemental-rum-pattern.md)
- [Manifest identity bound to execution and evidence](bind-eval-manifest-identity-to-execution-and-evidence.md)
- [Immutable experiment ledger boundary](mastra-seo-experiment-ledger-boundary.md)
- [Admin trace retention pattern](../platform/admin-search-trace-retention-pattern.md)
