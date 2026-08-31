---
id: "feat-379"
title: "Recommendation intent and profile controls"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: ""
duration: 4
depends_on:
  - "feat-375"
  - "feat-376"
  - "feat-378"
blocks:
  - "feat-380"
  - "feat-386"
  - "feat-389"
tags:
  - "admin"
  - "web"
  - "watch"
  - "recommendations"
  - "intent"
  - "profiles"
---

## Problem

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
- Test accessible viewer flows, context-builder separation, retention, and erasure.
- Reconcile sampled control changes in Admin.
- Run affected application checks: `pnpm --filter @forge/web test`, `pnpm --filter @forge/web lint`, and `pnpm --filter @forge/web typecheck`; `pnpm --filter @forge/admin test`, `pnpm --filter @forge/admin lint`, and `pnpm --filter @forge/admin typecheck`.
- Run `pnpm --filter roadmap lint` after updating roadmap metadata.
