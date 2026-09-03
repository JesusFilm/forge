---
title: "Harden a production recommendation slice at every irreversible boundary"
date: "2026-08-26"
last_updated: "2026-09-03"
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

This learning began with
[PR #1976](https://github.com/JesusFilm/forge/pull/1976), which merged on
2026-08-31, and now includes the source-neutral playback extension built for
feat-369.

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

### Treat playback as a source-neutral immutable measurement ledger

Watch playback is broader than recommendation playback. Direct, search, share,
acquisition, and editorial arrivals issue a one-use context without request,
item, or selection lineage; only the trusted selection path may create a
`recommendation` episode with complete lineage
(`apps/admin/src/services/recommendations/episode.service.ts:88-133`,
`apps/admin/src/services/recommendations/episode.service.ts:315-348`). The
database requires lineage to be wholly present or wholly absent and rejects
standalone recommendation attribution
(`apps/admin/prisma/migrations/0072_recommendation_source_neutral_playback_episodes/migration.sql:41-81`).
Discovery is bounded context, not attribution or learning eligibility.

Issue a short-lived claim nonce, store only its digest, and leave an unclaimed
context without a finalization deadline. Claim atomically binds session, media,
generation, and capability before facts are accepted
(`apps/admin/src/services/recommendations/episode.service.ts:88-133`,
`apps/admin/src/services/recommendations/episode.service.ts:595-727`). Put the
same mutation-admission guard in front of source-neutral context issuance as
the other public recommendation mutations
(`apps/web/src/app/api/recommendations/playback/route.ts:190-215`).

Keep playback fail-open. The recorder can observe and buffer bounded facts
while context claim is unresolved, retry an ambiguous claim with the same nonce
and event identities, and abandon telemetry without blocking the player. A
definitively stale recommendation handoff falls back once to a fresh standalone
context rather than discarding observed facts or inventing recommendation
lineage
(`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:315-423`).

Represent complete-coverage active playback only as explicit intervals in
which playback is both playing and document-visible. Close those intervals on
pause, buffering, stalling, hidden visibility, or BFCache suspension. A
persisted `pagehide` pauses and flushes measurement, then `pageshow` resumes the
same episode without counting time spent in cache; a non-persisted page
transition remains terminal
(`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:425-489`,
`apps/web/src/components/recommendations/RecommendationPlaybackRecorder.tsx:621-657`).
On the server, merge overlapping or adjacent active intervals and sum their
union. When visibility cannot be observed, preserve and surface partial
coverage rather than claiming foreground certainty. Position, progress, seeks,
elapsed wall time, and overlapping retries do not add to the interval total
(`apps/admin/src/services/recommendations/outcome.service.ts:85-128`,
`apps/admin/src/services/recommendations/contracts.ts:530-584`).

Watch assigns a stable event ID when each fact is created. Under the episode
boundary, the same event ID and payload digest is a replay; a different digest
is a conflict; only a new fact receives the next atomic server sequence
(`apps/admin/src/services/recommendations/playback.service.ts:191-389`). Late
facts append truth rather than rewriting it. When an accepted fact advances an
already timed-out episode, ingestion rearms finalization so the new watermark
can publish another revision
(`apps/admin/src/services/recommendations/playback.service.ts:319-338`,
`apps/admin/src/services/recommendations/playback.service.ts:452-468`).

Finalization binds each immutable outcome revision to an exact fact watermark
and input digest. Equal input replays exactly; later watermarks append a
monotonic revision with explicit supersession; stale generations, lower
watermarks, and same-watermark digest conflicts cannot become current
(`apps/admin/src/services/recommendations/outcome.service.ts:164-204`,
`apps/admin/src/services/recommendations/outcome.service.ts:290-413`). Retain a
rebuild path that independently derives watermark, digest, classifications,
duration cohort, coverage, and merged intervals from immutable facts and
reports any drift for operational enforcement
(`apps/admin/src/services/recommendations/outcome.service.ts:463-524`).

Publish through a stable source-neutral outcome envelope, then let downstream
consumers own integrity, consent, profile, and purpose-specific eligibility.
Measurement publication itself never authorizes learning
(`apps/admin/src/services/recommendations/playback-outcome-consumer.ts:12-104`).
If consumer dispatch fails after the outcome commits, rearm the durable due
marker and fail the workflow so recovery reuses the exact outcome and retries
delivery instead of silently losing it
(`apps/admin/src/services/recommendations/finalization/job.ts:179-211`).

Treat readiness as offline evidence, never live-ranking authority. Compare the
legacy position cohort with the active-time cohort over one closed, lagged
window, persist the exact evaluation revision, and enforce
`rankingInfluence = false`
(`apps/admin/src/services/recommendations/proxy-readiness.service.ts:29-199`,
`apps/admin/prisma/migrations/0072_recommendation_source_neutral_playback_episodes/migration.sql:158-195`).
Retention, backlog health, integrity, and authorized Admin trace views must
include standalone episodes as first-class roots.

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
- Playback tests cover unresolved and stale claims, BFCache suspension,
  duplicate terminals, replay, conflict, bounded lateness, interval union,
  monotonic supersession, consumer retry, and rebuild parity. A real PostgreSQL
  case races finalizers and proves the incremental outcome matches a fresh
  rebuild (`apps/admin/src/services/recommendations/playback-episode.db.test.ts`).
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
- [Atomic database lock and claim transitions](../database-issues/db-lock-must-be-atomic-update-not-select-for-update.md)
- [Durable Admin workflow operations](../best-practices/admin-postgres-workflow-operations-pattern-20260501.md)
- [Manifest identity bound to execution and evidence](bind-eval-manifest-identity-to-execution-and-evidence.md)
- [Immutable experiment ledger boundary](mastra-seo-experiment-ledger-boundary.md)
- [Admin trace retention pattern](../platform/admin-search-trace-retention-pattern.md)
