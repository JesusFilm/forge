---
id: "feat-370"
title: "Recommendation playback navigation and QoE signals"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-15"
duration: 4
depends_on:
  - "feat-369"
blocks:
  - "feat-504"
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

## September 15 implementation

The bounded Web collector and recomputable Admin observation projection now cover
pause/resume, seek direction, visibility/bfcache, startup timing, buffering and
unknown-severity errors. Each family has separate completeness and inconclusive
readiness. The Admin playback detail and explicitly bounded latest-20-episode
sample reconcile observations against attempts, starts and finalized episodes.

See `docs/validation/feat-504-playback-observations/README.md` for protocol,
mixed-version fallback, retention/access ownership, tests and browser/load proof.
Immediate departures remain unknown preference observations under feat-504.

At that point, manual-skip/replay intent, user/system pause causes,
recoverability/fatal severity, startup timeout, device/network breakdowns,
independent persisted readiness decisions and whole-window funnels were not
implemented. Raw navigation and QoE did not influence live ranking.

## September 24 reader-first rollout candidate

The v2 Admin and Web BFF contracts accept optional navigation and QoE facts
while the browser collector continues to emit v1. Admin projects the families
independently, reconciles dated full-window snapshots against attempts,
starts, finalized episodes and outcomes, and persists separate daily readiness
decisions. The expanded readers and Admin worker/bootstrap must deploy and be verified in production
before the v2 browser emitter is merged. See
`docs/validation/feat-370-playback-signals/reader-rollout.md` for the reader
contract, scale check, failure behavior and rollout order.

The v2 emitter, authorized Admin evidence gate and normal production
verification remain pending. The ticket remains in progress.
