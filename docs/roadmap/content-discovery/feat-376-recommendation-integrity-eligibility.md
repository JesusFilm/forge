---
id: "feat-376"
title: "Recommendation integrity and evidence eligibility"
owner: "nisal"
priority: "P0"
status: "not-started"
start_date: ""
duration: 6
depends_on:
  - "feat-368"
  - "feat-369"
  - "feat-372"
blocks:
  - "feat-377"
  - "feat-378"
  - "feat-379"
  - "feat-380"
  - "feat-381"
  - "feat-382"
  - "feat-383"
  - "feat-384"
  - "feat-386"
  - "feat-387"
  - "feat-389"
  - "feat-391"
  - "feat-392"
  - "feat-448"
tags:
  - "admin"
  - "watch"
  - "recommendations"
  - "integrity"
  - "privacy"
  - "eligibility"
---

## Problem

Accepted telemetry must remain distinct from the subset allowed to influence profiles, co-watch, experiments, or training.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U12 contract.
2. `apps/admin/src/services/recommendations/`
3. `apps/admin/src/app/dashboard/recommendations/`
4. `apps/admin/prisma/schema.prisma`

## Grep These

- `eligibility|integrity|quarantine`
- `actorClass|machine|internal`
- `contribution cap|distinct support`

## What To Build

- Derive actor class from verified authentication or server session and keep evidence acceptance separate from versioned learning eligibility.
- Add reason-coded contribution caps, distinct-support floors, velocity/replay checks, concentration/correlation detection, quarantine, and small-cohort suppression.
- Require explicit reclassification of pre-policy evidence; nothing becomes eligible merely because a projection reads it.
- Expose policy decisions and recomputation without treating criticism, disagreement, or negative survey content as abuse.

## Admin Evidence Gate

- Show accepted, pending, eligible, excluded, and quarantined counts before and after each policy version.
- Show anomaly concentration, reason codes, actor-class separation, contamination checks, and recomputation status.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Viewpoint and negative feedback are never integrity features.
- Machine, test, and internal traffic stays inspectable but excluded from human learning.
- Anonymous activity may inform aggregate quality only after support and concentration protections pass.
- Declare purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback/fallback for every new recommendation record.
- Preserve player startup and Watch availability when recommendation telemetry or Admin is degraded.

## Verification

- Run policy fixtures, replay storms, distributed low-rate abuse, machine/test/internal separation, later reclassification, and negative-feedback tests.
- Prove exact projection replacement after eligibility changes.
- Test Admin permissions and reconciliation.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
