---
id: "feat-390"
title: "Continuation recommendation candidates"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: ""
duration: 4
depends_on: []
blocks: []
tags:
  - "admin"
  - "watch"
  - "recommendations"
  - "continuation"
  - "candidates"
---

## October 2, 2026 closeout disposition

Cancelled under the owner's final recommendation-roadmap scope decision.
The proposed recommendation-generator integration for resume, course progression and authored next steps is retired as additional product scope. Existing playback, sequence navigation and continuation behavior remain; they are not proof of a provenance-rich shadow continuation generator.

Audit anchors: `apps/admin/src/services/recommendations/candidate.ts`, `apps/web/src/components/watch/`, `apps/web/src/lib/playback-navigation-intent.ts`.
The audit establishes the current scope and code boundaries, not new production
verification. See [the consolidated closeout record](../../reports/2026-10-02-recommendation-roadmap-closeout.md)
for owner, PR, evidence and remaining operational work. The requirements below
are historical and do not authorize new implementation.

## Historical problem

Resume, next episode, course progression, and authored sequence are continuation intents, not ordinary fresh discovery.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U23 contract.
2. `apps/admin/src/services/recommendations/candidates/`
3. `apps/web/src/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `resume|continue`
- `next episode|nextEpisode`
- `course.*next|sequence|autoplay`

## What To Build

- Nominate resume, next episode, course next step, and authored-sequence candidates as distinct reasons.
- Preserve sequence authority plus manual versus automatic transition state.
- Apply playability and locale eligibility without blending continuation invisibly into semantic discovery.
- Run in shadow and record a terminal decision.

## Admin Evidence Gate

- Show continuation reason, authority, manual/autoplay state, eligibility, coverage, overlap with semantic discovery, outcomes, and terminal decision.
- Expose conflicts between sequence authorities and deterministic fallback.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Continuation reason and sequence authority must survive union and ranking provenance.
- Completed or unavailable sequences fall back safely.
- This ticket does not change live autoplay or recommendation order.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test incomplete resume, next authored episode, course next step, completed series, deleted/unplayable next item, manual/autoplay, and conflicting authorities.
- Run generator, sequence, eligibility, and fallback fixtures.
- Reconcile continuation candidates and decisions in Admin.
- Run affected application checks: `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`; `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
