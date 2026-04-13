---
id: "feat-084"
title: "Enrich Now Feedback"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-13"
duration: 1
depends_on:
  - "feat-031"
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
---

## Problem

In production, the Manager Coverage dashboard's `Enrich Now` action does not give operators immediate confirmation that their click registered, and it does not clearly say that the backend accepted the enrichment request before the background job continues. This makes the action feel broken, invites duplicate clicks, and hides the handoff to the Jobs dashboard.

## Entry Points — Read These First

1. `apps/manager/src/features/coverage/coverage-report-client.tsx` — renders the Coverage selection bar and current `Enrich Now` click handler.
2. `apps/manager/src/features/coverage/enrich-selection.ts` — centralizes enrichment readiness, selection clearing, feedback, and redirect outcomes.
3. `apps/manager/src/features/coverage/enrich-selection.test.ts` — existing focused unit coverage for enrichment selection outcomes.
4. `apps/manager/src/app/api/enrich/route.ts` — creates enrichment jobs synchronously, schedules background work with `after()`, and returns `{ created, failed, jobs, errors }`.
5. `apps/manager/src/app/dashboard/jobs/new-job-form.tsx` — existing Manager precedent for `isSubmitting`, `Creating...`, status text, and an `Open job` link.
6. `apps/manager/src/features/jobs/live-jobs-table.tsx` — Jobs dashboard live status and polling handoff surface.
7. `apps/manager/src/app/globals.css` — existing `translation-feedback`, `translation-toast`, and `.translation-primary .icon.is-spinning` styling hooks.
8. `docs/brainstorms/2026-04-11-enrich-now-feedback-brainstorm.md` — UX brainstorm and chosen submission-feedback pattern.
9. `docs/plans/2026-04-13-fix-enrich-now-feedback-plan.md` — implementation plan with Red/Green TDD and smoke-test requirements.

## Grep These

- `Enrich Now|/api/enrich|resolveEnrichSelectionOutcome|enrichFeedback` in `apps/manager/src/`
- `isSubmitting|Creating...|Open job|role="status"` in `apps/manager/src/`
- `translation-feedback|translation-toast|is-spinning` in `apps/manager/src/app/globals.css`
- `after(async|created: jobs.length|failed: errors.length` in `apps/manager/src/app/api/enrich/route.ts`
- `jobs-live-status|Refresh now|/api/jobs?view=summary` in `apps/manager/src/features/jobs/`

## What To Build

1. Add an immediate pending state to the Coverage `Enrich Now` action:
   - disable the button while submission is in flight
   - change copy to `Creating jobs...`
   - expose polite live status text so assistive tech receives the same acknowledgement
   - prevent duplicate submits while the request is in flight
2. Change post-response feedback from "created and gone" to a clear accepted handoff:
   - one job: `1 enrichment job started.` with a link to `/dashboard/jobs/<jobId>`
   - multiple jobs: `{n} enrichment jobs started.` with a link to `/dashboard/jobs`
   - partial success: report both started and failed counts, keep failed videos selected
   - total failure: show the existing error summary and keep failed videos selected
3. Keep the Jobs dashboard as the source of truth for live progress. Do not build inline per-step progress in Coverage for this slice.
4. Preserve the existing redirect behavior only if it remains clear to the user that the backend accepted the request. Prefer visible in-place success feedback plus a Jobs link for the first iteration unless product explicitly wants auto-navigation.
5. Add Red/Green TDD coverage before implementation and record the failing-first evidence in work notes.
6. Complete a user smoke test in a browser against the real Manager Coverage flow before PR.

## Constraints

- Do NOT change enrichment workflow internals or step execution order.
- Do NOT add CMS schema changes or regenerate GraphQL types.
- Do NOT redesign the Coverage bar or Jobs dashboard.
- Do NOT add a new global toast system if the existing selection-bar feedback can do the job.
- Do NOT introduce new palette colors; reuse existing Manager styles and CSS hooks.
- Do NOT silently drop failed selections after partial or full failure.
- Do NOT use `--no-verify` when preparing the PR.

## Verification

- Red first:
  - `pnpm --filter @forge/manager test -- src/features/coverage/enrich-selection.test.ts`
  - any focused client helper/component test added for the pending action state
- Green after implementation:
  - `pnpm --filter @forge/manager test -- src/features/coverage/enrich-selection.test.ts`
  - `pnpm --filter @forge/manager lint`
  - `pnpm --filter @forge/manager typecheck`
  - `git diff --check`
- User smoke test:
  - start local CMS and Manager with the usual Manager auth setup
  - open `/dashboard/coverage`
  - select at least one language and one selectable video
  - click `Enrich Now`
  - confirm the button immediately changes to `Creating jobs...` and cannot be double-submitted
  - confirm success shows accepted/started copy plus a Jobs link, or partial/full failure keeps the right videos selected with clear error copy
  - follow the Jobs link and confirm the created job appears in the live Jobs surface
