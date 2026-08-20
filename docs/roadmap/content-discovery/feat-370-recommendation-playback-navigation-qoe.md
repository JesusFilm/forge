---
id: "feat-370"
title: "Recommendation playback navigation and QoE signals"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 4
depends_on:
  - "feat-369"
blocks:
  - "feat-391"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "playback"
  - "qoe"
---

## Problem

Technical playback failure and intentional navigation currently risk being interpreted as the same content-quality signal.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U3 contract.
2. `apps/web/src/components/watch/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `pause|seek|skip|replay`
- `buffer|startup|playback_error`
- `IntersectionObserver|visibilityState`

## What To Build

- Add bounded reason-coded navigation facts for pause, seek, skip, replay, and autoplay transitions.
- Add separate QoE facts for startup, buffering, recoverable failure, and fatal playback errors on the same episode lifecycle.
- Publish independent navigation and QoE projections, health states, and readiness decisions; do not insert either raw family into ranking.
- Add Admin funnels that reconcile each family separately against attempts, starts, and finalized outcomes.

## Admin Evidence Gate

- Navigation and QoE have separate coverage, missingness, device/network breakdowns, projections, and readiness decisions.
- Either family can be revise, retire, or inconclusive without hiding or blocking the other family’s evidence.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- This remains one vertical episode slice because navigation and QoE jointly explain playback, but each family must be independently verifiable.
- Preserve unknown causes when the browser cannot distinguish user, scroll, system, or network behavior.
- Neither signal family can influence live ranking from this ticket.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Test forward/back seeks, replay, manual skip, autoplay, user/system pause, startup timeout, buffering, fatal errors, duplicates, unsupported signals, and constrained batching.
- Prove independent projection recomputation and Admin reconciliation for both signal families.
- Run focused Web and Admin tests plus affected-app lint and type checking.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
