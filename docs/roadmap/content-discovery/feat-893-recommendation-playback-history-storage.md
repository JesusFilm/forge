---
id: "feat-893"
title: "Move recommendation playback history without losing serving authority"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-10-28"
duration: 3
depends_on: ["feat-889", "feat-890", "feat-891"]
blocks: ["feat-897", "feat-894", "feat-895"]
tags: ["recommendations", "storage", "clickhouse", "admin"]
---

## Scope and acceptance

Own recommendation delivery/evidence/episode/playback/outcome/content-action writers and history integration for recent context, user history, profile and co-watch. Separate compact request/item/handoff/replay/finality/eligibility authority from retained payloads; keep bounded temporary operational facts for open episodes. After operational commit, dispatch history without awaiting the send, queueing or retrying. Preserve sequence, revision, immediate exclusions, privacy and original expiry. Complete operational facts through the committed episode sequence still drive finalization; missing ClickHouse exports cannot silently finalize partial episodes. Bounded history readers preserve source-neutral/attributed outcomes and expose incomplete coverage. Replace raw-source FKs with explicit lineage/revalidation. Include usefulness/operator compatibility. This ticket remains incomplete while an accepted raw family remains permanently duplicated in PostgreSQL.

## Context

- Parent: [feat-897](feat-897-recommendation-event-storage-migration.md).
- Specification: [event storage migration](../../plans/2026-10-28-recommendation-event-storage-spec.md).
- Read `AGENTS.md`, `apps/admin/AGENTS.md`, relevant `apps/admin/CLAUDE.md` guidance and `docs/analytics-and-recommendation-policy.md`.
- Duration is a planning placeholder. Completion requires integrated tests and receipts for this scope; production claims belong to feat-896.

## Evidence

First writer slice: request and ordered served-item summaries from both live
and precomputed issuance paths; bounded candidate-stage trace fields; accepted
render/impression and selection facts; source-neutral and attributed episode
creation/claim state; accepted sequenced playback facts; published outcome
revisions and final episode state; accepted content-action receipts. Producers
snapshot operational writes and start a single, bounded, measured history send
only after commit. Replays do not re-export. The export gate remains off by
default. Episode creation starts at `history_revision = 1`; committed claim
and finality transitions increment it under the existing episode lock so
classifier revisions cannot collide as episode history. The schema migration
was applied to an isolated PostgreSQL 18 container and verified that rollback
keeps revision 1 while a committed increment reaches revision 2. No serving or
playback read has moved to ClickHouse.

This slice intentionally excludes raw candidate `sourceEvidence`, arbitrary
source-neutral provenance, action detail and destination artifact identifiers
from the export. These require a field-by-field redaction and reader contract
before any PostgreSQL raw columns can be removed. The opaque destination audit
ID is exported; destination erasure leaves it intact and remote history holds
no artifact type or ID. Feat-895 still must provide erasure fencing for any
future identity-bearing export and prove remote physical deletion semantics.
Selection attribution now uses a deterministic revision: a pending selection
is revision 1, and one with a persisted `attribution_eligible_at` is revision 2
whether the impression preceded creation or was reconciled later. Both evidence
and selection-replay reconciliation export revision 2 only after commit. The
persisted attribution timestamp is its acceptance time. Eligibility decisions
export their existing immutable policy revisions after classification commits;
unchanged receipts do not re-export. Episode claim/finality and outcome
publication already use committed revisions. Content-action replay counters and
destination artifact erasure do not change exported fields. Misconfigured
enabled export counts eligible family drops without preparing payloads;
deliberately disabled export is measured separately. Request export uses the
committed latency even if the clock advances while commit returns. Typed
envelope errors retain `invalid_input` classification without surfacing input.
Eligibility correction exports use the finalization worker's dispatcher or the
profile reconciliation batch's worker dispatcher, with one drain at each
bounded worker boundary.
Complete diagnostic trace/source evidence and corresponding readers still
need a field-by-field contract. The current candidate-run and stage exports
remain bounded summaries, not complete archival trace payloads.

Compact-state retirement remains: replace request/item roots with issuance,
capability and replay binding columns (`delivery_jti`, `signing_kid`,
`generation`, `state`, `expires_at`, item capability/target/position), retain
selection nonce/claim and attribution windows, episode capability/generation,
`next_fact_sequence` and finalization horizon, and bounded per-episode
fact/digest/sequence indexes until finality. Detach current FKs from request,
item, selection and episode into explicit stable IDs with expiry/privacy
revalidation before deleting their raw payloads. Current outcome/eligibility
pointers, profile/co-watch contributions, A/B visit/assignment/link/click
accounting and authorized operator reads still depend on PostgreSQL history.
Reader replacement, parity/backfill and actual storage retirement follow in
this ticket and feats 894–895; this ticket stays in progress.
