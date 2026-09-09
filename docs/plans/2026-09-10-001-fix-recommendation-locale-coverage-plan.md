---
title: Diagnose and repair recommendation locale coverage
type: fix
status: completed
date: 2026-09-10
origin: docs/brainstorms/2026-09-10-recommendation-locale-coverage-requirements.md
---

## Problem and boundary

Recommendation requests combine a transcript locale and an exact audio-language slug. Missing requested-locale published metadata can exclude content even when compatible embeddings and audio exist. Establish each stage before changing retrieval, rebuilding embeddings, or adopting a text fallback. Production usage remains in `.tmp/recommendation-locale-coverage/`.

## U1: Reproducible coverage diagnosis

Create `apps/admin/src/services/recommendations/coverage-diagnostics.ts`, its colocated unit/database tests, and `apps/admin/src/scripts/diagnose-recommendation-coverage.ts`. Add an Admin package command and `docs/operations/recommendation-locale-coverage.md`.

Use exact input locale/seed/audio identities, shared active-contract SQL, parameterized queries, and enforced read-only transactions with bounded statement/lock/connection timeouts. Count the stages separately and report available published locale labels without automatically accepting them. Inventory counts are not ANN output or guaranteed six-card fill. Existing request rows do not persist requested audio for empty results, so explicit audit audio must not be imputed as historical input.

Tests: usable inventory; absent seed; incompatible parent/chunk contract; seed/direct-family exclusion; missing/unpublished/deleted locale; alternative Chinese script metadata; exact audio versus same-BCP47 sibling; missing playback and incompatible edition; read-only/timeout enforcement; invalid inputs. Follow `content-embedding-contract.ts` and `delivery-retriever.db.test.ts`.

## U2: Verified remediation or source handoff

Trace confirmed deficits to their owner. Apply only a mapping/eligibility correction justified by established behavior or the user's explicit display-policy decision, with affected real-database and service regression tests. If the cause is absent localized source or requires an unresolved display-policy decision, preserve serving behavior and supply a bounded prioritized handoff in the operational guide and a follow-up ticket, linked bidirectionally where dependent.

Do not change GraphQL or Web contracts merely to increase fill; any approved fallback needs cache, hydration, publication, candidate evidence, and exact-audio checks to agree. Remeasure latency and eligibility if serving changes. Source/backfill execution remains outside this read-only production investigation.

## U3: Validation and closeout

Run focused unit and isolated PostgreSQL integration tests, Admin typecheck/lint and touched-file format checks. Re-run the shipped diagnostics against production sequentially; record fixed time bounds and service revisions. Review the diff under Compound Engineering, capture the durable learning, and prepare a scoped PR with sanitized validation. Keep any uncompleted rollout gate explicit.

## Execution-time unknowns

Whether each failing source lacks timed text, active chunks, published metadata, or compatible audio; whether a bounded candidate window contributes independently; whether the user authorizes a display fallback. No ranking or paid enrichment work is assumed.
