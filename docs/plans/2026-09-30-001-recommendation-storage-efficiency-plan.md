---
title: Reduce recommendation storage growth and retire unprotected legacy detail
status: active
date: 2026-09-30
---

## Authorized outcome

Reduce production storage and ongoing growth while retaining recommendation output,
attribution, exact historical observations for protected traces, and normal expiry
and erasure. The owner explicitly authorized early deletion of unprotected old
legacy stage detail; preserve original quality-audit holdouts and active/linked
investigations. Do not delete request roots or their operational descendants to
achieve this. No production mutation is implicit in a local benchmark.

Only fresh task-owned agents/worktrees may receive delegation. Never send work to
existing chats or other agents' tasks. Root coordinates all production actions.

## Current evidence

September29 catalog comparison00:55–19:05UTC: request/served2.802GB grows0.086GB/day,
viewer event/derived3.495GB grows0.545GB/day, profile family1.447GB grows0.050GB/day.
These are short pre-retention allocation slopes, not steady-state monthly forecasts.
Request/event indexes total2.634GB of6.297GB. A497-item sample has693B provenance
and718B presentation per1678B datum. Watch exposure has a142MB eight-column index.
Profile interests hold a1536-float vector each and allocate0.670GB; exact duplicate
input generations are already reused. Legacy stage allocation remains18.393GB.
Read-only receipts live in the task's September28 Codex document heartbeat bundle.

## Implementation units

### U1 — Low-risk index and exposure efficiency (feat-574)

Review constraint, foreign-key, ORM-selector and query-plan dependencies before
removing logically redundant indexes. First evaluate rendered fact composite
uniqueness already implied by non-null single-column uniqueness. Keep necessary
request lookup, identity, replay, expiry and attribution indexes. Test exact
uniqueness/lineage and old-reader compatibility in disposable PostgreSQL. Narrow
Watch exposure indexes only with loaded plan/latency proof and a bounded migration
path; do not add CONCURRENTLY to Prisma's unsupported transactional migration flow.
If a larger exposure normalization is needed, first prove lossless storage/latency
benefit with exact per-event identities, timing, visibility, reporting and expiry.

### U2 — Lossless served-item physical compaction (feat-574)

Before introducing new application storage formats, benchmark PostgreSQL TOAST
threshold/compression changes on representative independent JSON snapshots. Measure
complete heap/index/TOAST and WAL bytes, read/write latency and exact field equality.
No rewrite of retained production data. If physical settings do not yield material
safe improvement, implement versioned immutable shared snapshots with thin item
identity/lineage records and a compatible mixed reader. Mutable catalog lookup is
not a historical snapshot. No changes to ranking, served denominators or attribution.

### U3 — Profile storage efficiency (feat-574)

Prove whether byte-identical full-precision content-vector snapshots can be shared
without changing profile membership, weights, generation history, source lifetime,
erasure, query latency or candidate results. Measure native PostgreSQL benefit
before schema expansion. No half-precision conversion or automatic history removal.
Reuse of unchanged inputDigest is already implemented; do not add duplicate logic.
Any unsupported shape/version must preserve existing behavior.

#### U3 follow-up — Initial no-evidence footprint

The user prioritizes making the full profile family substantially smaller.
September 29 at 22:19 UTC, 218,001 of 218,003 first durable generations declared
no evidence. The recent cohort's median initial publication was 0.470 seconds
after profile creation. This supports a narrow future-write optimization;
existing generations must not be deleted or rewritten.

Prefer avoiding ordinary initial status/grant dispatch under the existing
per-scope dispatch transaction lock. Admit a skip only for a valid durable
profile/privacy scope with no current pointer, no prior scoped generation or
projection run, and no raw evidence in any channel. Validate the active session
link as well as the active profile/privacy generation. Explicit feedback,
reconciliation and session-scope work always retain the existing path. The source
test must conservatively cover raw selection/playback episode/outcome rows,
including pending eligibility, across initiating and active linked sessions.
Include raw explicit-preference and negative-action channels. The eligible
evidence loader alone cannot prove absence; downstream publisher arrays also
filter out unavailable embeddings. Both pending and missing-embedding evidence
must retain normal publication. Check indexed query plans and bounded work.

Return an explicit internal skipped outcome, distinct from unavailable/revoked
authority, so the existing dispatcher does not turn a successful skip into an
exception. Keep the public GraphQL contract and all persisted job/receipt shapes
unchanged. Preserve profile/consent/session creation, normal candidate fallback,
all later empty replacements and nonempty publications. Add a reversible gate;
avoid a new table or identity-bearing logging. Do not use a completed-null
projection run as a substitute without a separately reviewed compatibility plan.

Before implementation, trace all raw evidence producers and prepare callers.
Prove both dispatch lock orderings: a skip creates no run that can swallow later
feedback, while a feedback run prepared first prevents a skip. Cover evidence
arriving during/after preparation, late watermarks, raw evidence without vectors,
first nonempty upgrade, prior pointer/generation/run exclusions, session scope,
reconciliation, privacy reset/erasure and unchanged serving/shadow fallback.
If any source can be lost because no initial job exists, stop and resolve that
counterexample before activation; do not waive it as an existing race.

The review identified one such window: the old pending initial workflow can
observe an eligible source committed before its evidence load when asynchronous
feedback fails. A skipped bootstrap has no pending workflow. Preserve that
recovery by reserving an existing pending projection run atomically with the first
profile-eligible selection or playback-outcome decision, using the same dispatch
lock and active profile/link/privacy checks. Ineligible decisions create no
reservation. Existing stale-run reconciliation must discover the null-workflow
reservation after feedback failure; successful feedback must coalesce it without
losing a later watermark. Do not add a per-empty-profile marker or an unbounded
raw-source sweep. Test decision replay, both lock orders, privacy/link changes,
failure followed by reconciliation and actual first nonempty publication.

Measure whole fixture heap/index/TOAST and WAL with the same input mix, retaining
the common core profile, consent, link and audit footprint. Include avoided
workflow rows in the comparison. Measure dispatch/status latency under load,
because the no-pointer path now performs raw-evidence reads before skipping.
Only publish the affected fixture's measured reduction, not an assumed population
or filesystem saving.

Use a separate reviewed PR and normal deployment after the current shared-vector
and packed-item activation checks. Update this plan if analysis proves the
minimal compatible result cannot safely represent these cases. Do not broaden
to changes in consent/product behavior or historical deletion.

### U4 — Protected early legacy retirement (feat-575)

Deploy explicit retired-detail state/readers before deleting unprotected stage rows.
Preserve issuance counters as historical facts. Freeze a fresh conservative protected
set including original64 holdouts, active investigations and current assignment,
shadow, experiment exposure, promotion fence, conflict and access-audit links.
Preserve uncertain/unrepresentable rows. Existing selective converter rejects holds;
use a dedicated protected conversion path with exact SQL fingerprints and typed
bidirectional parity without relaxing representation checks. Keep original expiry.
Use bounded manifest-bound operations with durable aggregate progress, idempotency,
retention locking and exact parent/run/source checks. No unbounded delete/retry loop.
A protected row that cannot be represented blocks whole-table reclamation. Never
claim deletion itself returns18GB to disk. A later separately reviewed migration
must lock with a short bound, prove exact emptiness and restrictively truncate,
without CASCADE. Keep a retirement-aware rollback image. No direct local-code deploy.

## Verification and release

Use distinct owned loopback PostgreSQL databases; never alter another task's DB.
Tests must cover full data/reader parity, integrity, expiry/erasure and failure/race
behavior. Measure physical bytes and latency, not only serialized JSON size. Run
Admin schema/migration consistency, typecheck, lint/format and appropriate focused
unit/native DB checks. Every production change uses reviewed PR-to-main deployment.
Inspect actual HTTP/worker revisions, health, rollback floor and fresh disk/WAL
before mutations. First two loaded normal retention cycles still must be proven
for feat-554 even if exceptional cleanup frees capacity sooner. Feat-555 only closes
after actual physical recovery. No financial commitments or warehouse migration.

## Ownership

Root owns this plan, storage benchmark/measurement, integration, review and any
production action. Fresh dedicated agents own bounded isolated code/benchmark
units. Initial migration names are provisional and must be renumbered against
current main and known reservations before PR integration; do not edit applied SQL.
