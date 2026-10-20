---
id: "feat-746"
title: "Start public A/B tests from completed saved generations"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-20"
duration: 3
depends_on:
  - "feat-745"
blocks:
  - "feat-754"
tags:
  - "admin"
  - "web"
  - "recommendations"
  - "experiments"
---

## Problem

Public launch accepted only qualified analytics/model generations and required
baseline, capacity and human-verification evidence. The owner explicitly asked
to remove these prerequisites and test `editorial-catalog-20261019-v1` publicly.

## Implementation

- `apps/admin/src/services/recommendations/precomputed/public-control.ts`:
  `startSavedPrecomputedPublicExperiment` freezes any complete saved generation
  and current routing, then starts an ordinary 50/50 browser cohort for one month.
- `public-watch.ts`, `watch-delivery.ts`, `visit-admission.ts`: reuse saved
  delivery and durable visit binding without private feature flags. Keep source
  visibility, audio playback, signed browser identity and bot filtering.
- `ctr-policy.ts`, `ctr-report.ts`: observed public counts and browser-clustered
  intervals, with manual selection of a clear final winner. Preserve verified
  workflow semantics without requiring them for ordinary experiments.
- Admin `public/controls.tsx` and `api/.../public-control/route.ts`: generation
  picker, one-step start, measurement, and rollback; same authorization and CSRF.
- Migration `0161_precomputed_public_browser_ab` adds authority values; it does
  not activate a generation or alter imported provenance.

## Verification and release

Native PostgreSQL tests cover editorial launch, retries, stale transitions,
sticky assignment, empty visits, observed reports, rollback and existing private
delivery/click accounting. Run the ordinary lifecycle with the private flag off.
Verify route authorization, public Web routing, CTR statistics and Admin UI.
Run scoped types, lint, formatting and CI. Deploy through PR-to-main, then select
the exact editorial generation and verify public serving.

## References

- `docs/plans/2026-10-20-001-public-saved-recommendation-ab-plan.md`
- `docs/operations/precomputed-public-control.md`
- `docs/reports/2026-10-20-editorial-recommendation-ab-feasibility.md`

No regeneration, editorial qualification layer, invented transcript/model/GA
receipts, private tester links, or direct production deployment.

## Completion evidence

Implementation validated locally: PostgreSQL launch/delivery/click/report/
promotion/rollback with private testing disabled; existing private and verified
paths retain their contracts. Focused Admin and Web tests, scoped TypeScript,
touched-file ESLint and formatting pass. Admin controls rendered in a browser
using the real stylesheet; isolated SSR p95 was 3.0 ms versus 4.1 ms before
(100 samples, local diagnostic only). No new viewer assets or initial requests.
Normal PR deployment and operator activation follow implementation delivery.
