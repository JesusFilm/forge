---
id: "feat-379"
title: "Recommendation intent and profile controls"
owner: "nisal"
priority: "P1"
status: "cancelled"
start_date: ""
duration: 4
depends_on: []
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "intent"
  - "profiles"
---

## October 2, 2026 closeout disposition

Cancelled under the owner's final recommendation-roadmap scope decision.
The proposed purpose prompts and five title-level feedback actions are additional product scope and are retired. Existing personalization disable/reset/delete controls and distinct durable/session projection fields remain mandatory; their presence does not mean the proposed explicit title actions were implemented. No transient search intent becomes durable preference by this cancellation.

Audit anchors: `apps/web/src/components/recommendations/RecommendationConsentShell.tsx`, `apps/admin/src/services/recommendations/profiles/projection.ts`, `apps/admin/src/services/recommendations/profiles/privacy.ts`.
The audit establishes the current scope and code boundaries, not new production
verification. See [the consolidated closeout record](../../reports/2026-10-02-recommendation-roadmap-closeout.md)
for owner, PR, evidence and remaining operational work. The requirements below
are historical and do not authorize new implementation.

## Historical problem

Viewer purpose, short-term session intent, long-term interests, and negative evidence must remain distinct and controllable.

## Entry Points — Read These First

1. `docs/plans/2026-08-18-2219-feat-watch-recommendation-learning-system-plan.md` — canonical architecture and U11 contract.
2. `apps/web/src/components/`
3. `apps/admin/src/services/recommendations/`
4. `apps/admin/src/app/dashboard/recommendations/`

## Grep These

- `purpose|intent|preference`
- `interest|negative feedback`
- `reset|undo|personalization`

## What To Build

- Add optional, discoverable controls for current purpose and recommendation preferences with an immediate value explanation.
- Keep surface-derived purpose, declared purpose, session intent, long-term interests, and negative evidence as separate inputs.
- Add explicit title-level feedback actions with distinct semantics: `more_like_this`, `not_for_me`, `hide_title`, `already_watched`, and `reset_influence`. Preserve the selected action, target, source request, policy version, undo state, and effective profile generation.
- Implement undo/reset, transient-purpose expiry, decline and never-ask behavior, and persistent access to management controls.
- Publish adoption, disagreement, missingness, resets, and downstream outcome comparisons without coercive prompting.

## Admin Evidence Gate

- Show inferred versus declared purpose, adoption, decline, reset, expiry, missingness, and outcome comparisons.
- Make profile changes and their effective recommendation generation inspectable without exposing raw viewer histories.

The ticket is not complete until this result is visible and reconcilable in the authorized Admin Recommendations area.

## Constraints

- Profile prompts are optional and cannot block watching.
- A transient purpose never silently rewrites durable interests.
- `not_for_me` is an explicit preference signal, `hide_title` is an immediate presentation constraint, and `already_watched` is completion/continuation state; none may be inferred from short playback or substituted for another.
- The viewer must be able to find controls after the original prompt and understand the post-reset state.
- Every new recommendation record declares purpose, identity class, retention, access, deletion behavior, ingestion health, and rollback or fallback.
- Watch serves viewers; Admin observes, verifies, and controls. Admin is not the viewer recommendation surface.

## Verification

- Test find-to-share, course-building, ordinary watching, reset, inferred/declared conflict, decline, never-ask, negative feedback, anonymous session-only use, and expiry.
- Test each title action, undo, repeated submission, conflicting actions, source-request attribution, profile-generation fencing, and separation from completion and short-playback evidence.
- Test accessible viewer flows, contextual semantic delivery with personalization disabled, default-enabled profile controls, context-builder separation, retention, and erasure.
- Reconcile sampled control changes in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
