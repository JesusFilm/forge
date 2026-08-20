---
id: "feat-372"
title: "Recommendation mission-value actions"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 4
depends_on:
  - "feat-368"
  - "feat-369"
blocks:
  - "feat-374"
  - "feat-375"
  - "feat-376"
  - "feat-377"
  - "feat-380"
  - "feat-381"
  - "feat-390"
  - "feat-391"
  - "feat-392"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "sharing"
  - "courses"
---

## Problem

Shares, saves, course additions, and continuation can demonstrate mission value even when watch duration is short.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U5 contract.
2. `apps/web/src/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `share|save|course`
- `continue|nextEpisode`
- `contentAction|mission`

## What To Build

- Record idempotent share, save, course-add, continuation, and related action receipts.
- Link actions to request, served item, episode, discovery source, purpose, and destination artifact when those facts exist.
- Keep human action, machine disposition, and reported survey value as distinct eligibility classes.
- Publish per-action readiness decisions and unmatched-attribution health.

## Admin Evidence Gate

- Show impression-to-action and playback-to-action funnels, unmatched action counts, provenance, and duplicate suppression.
- A short watch followed by a mission action remains visible as mission value without being rewritten as a long watch.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Do not fabricate recommendation attribution for direct or external arrivals.
- Do not collapse distinct mission actions into watch duration or one opaque quality label.
- Deleting a destination artifact preserves only the explicitly allowed audit linkage.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test duplicate actions, direct navigation, late actions, deleted destinations, machine separation, and erasure.
- Reconcile raw receipts, projections, and Admin funnels.
- Run focused Web/Admin tests, lint, and type checks.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
