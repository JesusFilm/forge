---
id: "feat-388"
title: "Editorial recommendation candidates"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 4
depends_on:
  - "feat-373"
  - "feat-382"
  - "feat-383"
blocks:
  - "feat-393"
tags:
  - "admin"
  - "watch"
  - "recommendations"
  - "editorial"
  - "candidates"
---

## Problem

Existing published editorial collections should participate in recommendation architecture without losing authored order, pins, or approved-pool intent.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U21 contract.
2. `apps/admin/src/domain/blocks.ts`
3. `apps/admin/src/services/recommendations/candidates/`
4. `apps/admin/src/app/dashboard/recommendations/`
5. `apps/web/src/components/`

## Grep These

- `MediaCollection|media collection`
- `fixed|pinned|approved pool`
- `publishedVersion`

## What To Build

- Adapt published media collections into provenance-rich authored-slate, approved-pool, and pinned-fill candidate forms.
- Preserve fixed order and pins as policy constraints while allowing only approved-pool items to be rankable.
- Exclude unpublished versions and retain collection/version provenance across locale and deduplication checks.
- Run editorial contribution in shadow and record a terminal decision.

## Admin Evidence Gate

- Compare authored position with counterfactual candidate and composed positions, including pins, duplicates, locale eligibility, and published version.
- Show contribution, overlap, rejection reasons, and promote-to-experiment, revise, retire, or inconclusive.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Fixed authored order cannot be silently reranked.
- Only published collection versions are eligible.
- Watch’s existing editorial blocks remain functional while the adapter is shadow-only.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test fixed order, approved pools, pinned fill, unpublished versions, locale mismatch, duplicates across collections, and editor updates.
- Run domain, GraphQL, adapter, and Watch authored-rendering regression tests.
- Reconcile authored and shadow positions in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`; `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
