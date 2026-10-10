---
title: "fix: Enrich Now feedback"
type: fix
status: completed
date: 2026-04-13
branch: fix/enrich-now-feedback
related_roadmap:
  - docs/roadmap/media-generation/feat-084-enrich-now-feedback.md
related_docs:
  - docs/brainstorms/2026-04-11-enrich-now-feedback-brainstorm.md
  - docs/roadmap/media-generation/feat-030-video-content-discovery-dashboard.md
  - docs/roadmap/media-generation/feat-031-ai-video-enrichment-pipeline.md
  - docs/solutions/integration-issues/manager-coverage-dashboard-review-regression-cleanup.md
  - docs/solutions/integration-issues/manager-coverage-language-first-empty-state-20260410.md
  - docs/solutions/platform/videoforge-manager-integration.md
  - docs/solutions/platform/backfill-worker-pattern-manager-20260407.md
  - docs/solutions/ui-bugs/manager-enrich-now-feedback-handoff-20260413.md
---

# fix: Enrich Now feedback

## Overview

Add clear submission feedback to the Manager Coverage dashboard's `Enrich Now` action. The first implementation should follow the submission-feedback pattern from the brainstorm: immediate pending button state, accepted/error feedback after `/api/enrich` returns, and a visible handoff to the Jobs dashboard where live progress already belongs.

This is a UX bug fix, not a new enrichment pipeline feature. The backend already creates jobs before scheduling background enrichment with `after()`, so the UI can honestly say that work has started without waiting for the workflow to finish.

## Problem Statement

In production, clicking `Enrich Now` gives no immediate feedback beyond the browser's native pressed state. The button keeps saying `Enrich Now`, the selection bar stays quiet while `/api/enrich` performs job creation preflight work, and the user only gets a result after the response or a redirect.

That breaks two operator expectations:

1. "Did my click register?"
2. "Did the backend accept my request and start anything?"

The current behavior also makes slow requests and partial failures hard to understand. A user can reasonably click again, leave the page, or assume nothing happened even though the backend may be creating jobs and scheduling background enrichment.

## Proposed Solution

Keep this slice intentionally small:

- Add client submission state to the Coverage selection bar.
- Disable the `Enrich Now` button during the in-flight request.
- Change button copy to `Creating jobs...` and use the existing spinning icon hook if useful.
- Show a polite `role="status"` message while creating jobs.
- After a successful response, show accepted/started copy with a Jobs link:
  - one job links to `/dashboard/jobs/<jobId>`
  - multiple jobs link to `/dashboard/jobs`
- Preserve failed selections and make partial success copy explicit.
- Keep the Jobs dashboard as the live progress surface; do not build per-step progress into Coverage yet.

## Research Summary

Found brainstorm from 2026-04-11: `enrich-now-feedback`. The brainstorm recommends the submission-feedback pattern over micro-feedback-only or inline progress handoff.

Local repo research found strong existing patterns:

- `apps/manager/src/features/coverage/coverage-report-client.tsx` currently posts `/api/enrich` with no pending state and only sets feedback after the response.
- `apps/manager/src/features/coverage/enrich-selection.ts` already centralizes full success, partial success, and full failure outcomes.
- `apps/manager/src/app/api/enrich/route.ts` returns `201` with `{ created, failed, jobs, errors }` after jobs are created and schedules enrichment afterward with `after()`.
- `apps/manager/src/app/dashboard/jobs/new-job-form.tsx` already uses `isSubmitting`, `Creating...`, a status message, and an `Open job` link.
- `apps/manager/src/features/jobs/live-jobs-table.tsx` already owns live job refresh status.
- `apps/manager/src/app/globals.css` already has `translation-feedback`, `translation-toast`, and `.translation-primary .icon.is-spinning` hooks.

Compound docs to incorporate:

- `manager-coverage-dashboard-review-regression-cleanup.md`: model UI state explicitly instead of collapsing empty, loading, and failure states.
- `manager-coverage-language-first-empty-state-20260410.md`: coverage UX should have clear entry states and should avoid state churn that makes context vanish.
- `backfill-worker-pattern-manager-20260407.md`: claim/accept work synchronously, then run longer work in the background.
- `videoforge-manager-integration.md`: Manager uses `after()` for background work and should keep job state as the durable surface.

External research skipped: the codebase has direct local patterns for this interaction, and the change does not introduce new libraries, security-sensitive flows, payment/data-privacy logic, or unfamiliar framework behavior.

## SpecFlow Notes

User flows:

1. Ready-to-submit: user selects at least one language and one selectable video, then clicks `Enrich Now`.
2. Accepted success: backend returns created jobs; UI reports that jobs started and links to Jobs.
3. Partial failure: some jobs are created, failed videos remain selected, and copy says both outcomes.
4. Full failure: no jobs are created, selected videos remain selected, and error copy stays visible.
5. Slow request: the button stays disabled with stable pending copy until the request settles.

Important edge cases:

- double-click prevention while submission is in flight
- keeping failed selections after mixed/full failures
- avoiding a redirect that hides accepted feedback too quickly
- preserving language-selection validation copy when the action is not ready
- session-expired handling should continue to be owned by `apiFetch`

## Scope Boundaries

In scope:

- Coverage selection-bar pending state.
- Accepted/error feedback copy and Jobs links.
- Focused helper/component tests for pending, accepted, partial, and failure states.
- User smoke test through the real Manager Coverage UI.
- Roadmap and plan docs for this fix.

Out of scope:

- Enrichment workflow internals.
- New CMS fields, GraphQL operations, or generated types.
- Jobs dashboard redesign.
- Global toast infrastructure.
- Inline per-step progress on Coverage.
- Automatic retry, cancellation, or job deduplication.

## Implementation Plan

### Unit 1: Outcome copy and Jobs handoff helpers

Red:

- Update `apps/manager/src/features/coverage/enrich-selection.test.ts`.
- Add failing tests for accepted copy and link target:
  - one created job yields `1 enrichment job started.` plus `/dashboard/jobs/<jobId>`
  - multiple created jobs yield `{n} enrichment jobs started.` plus `/dashboard/jobs`
  - partial success includes both started and failed counts and keeps only failed selections
  - full failure keeps all failed selections and has no Jobs link

Green:

- Extend `EnrichFeedback` or introduce a small adjacent type so feedback can carry an optional Jobs link.
- Update `resolveEnrichSelectionOutcome()` to return clear accepted/started copy.
- Keep `redirectPath` only if the implementation still needs it; prefer an explicit link in the feedback state for this fix.

Refactor:

- Keep this logic in `enrich-selection.ts` so the React component stays mostly presentation and request orchestration.

### Unit 2: Pending state for the Coverage action

Red:

- Add a focused testable helper if needed, or add a small component-level smoke harness if the current node-only Vitest setup can cover it without adding heavy test infrastructure.
- The failing expectation should prove that while submission is in flight:
  - the button is disabled
  - the label changes to `Creating jobs...`
  - a polite status message is present
  - a second click cannot send a duplicate request

Green:

- Add `isEnrichSubmitting` state near `enrichFeedback` in `coverage-report-client.tsx`.
- Set it before calling `apiFetch("/api/enrich", ...)`, reset it in `finally`.
- Update `disabled` to include `isEnrichSubmitting`.
- Change the button label to `Creating jobs...` while pending.
- Add `aria-busy` or equivalent status semantics where useful.
- Use existing `.translation-primary .icon.is-spinning` rather than adding new styling if a spinner is used.

Refactor:

- Avoid changing unrelated Coverage selection, hover, filter, or language-query behavior.

### Unit 3: Accepted, partial, and error feedback rendering

Red:

- Extend the focused tests from Unit 1 or add a render-level check to prove:
  - accepted feedback renders a Jobs link
  - partial success copy reports both counts
  - failures remain visible after the request settles

Green:

- Render the optional feedback link near the existing `translation-feedback` message.
- Use existing feedback tones. If a new tone is needed, prefer the existing `success` tone already in CSS.
- Keep language-selection-required feedback unchanged when the action is not ready.
- Preserve `apiFetch` session-expired behavior by leaving the existing catch semantics intact.

Refactor:

- If the existing `translation-toast` CSS is used, wire only the minimal markup needed. Do not create a reusable toast system in this PR.

### Unit 4: User smoke test and PR hygiene

- Continue on `fix/enrich-now-feedback`, targeting `main`.
- Keep the PR scope to `apps/manager`, this plan, the brainstorm, and the roadmap ticket.
- Use PR title `fix(manager): add Enrich Now feedback`.
- Before PR creation, run `gh pr list --state all --limit 20` to match current PR title/body conventions.
- Do not skip hooks with `--no-verify`.
- After implementation and review, update `docs/roadmap/media-generation/feat-084-enrich-now-feedback.md` to `status: "complete"`.
- Run `ce:review` before PR and `ce:compound` after completion to capture any reusable learning.

## Acceptance Criteria

- [x] `Enrich Now` visibly changes state immediately after click.
- [x] While `/api/enrich` is in flight, the button is disabled and duplicate submits are prevented.
- [x] Pending copy says `Creating jobs...` or equivalent explicit submission copy.
- [x] The selection bar exposes a polite live status for pending and result states.
- [x] When one job is created, the result says the enrichment job started and links to that job detail page.
- [x] When multiple jobs are created, the result says enrichment jobs started and links to the Jobs list.
- [x] Partial success reports created and failed counts, clears created videos, and leaves failed videos selected.
- [x] Full failure leaves failed selections intact and shows error copy.
- [x] The Jobs dashboard remains the source of truth for live progress.
- [x] Red/Green TDD evidence is captured in work notes.
- [x] A user-like browser smoke test is completed against the rendered Manager enrichment action states.
- [x] Manager lint and typecheck pass before PR.

## Work Notes

- Red helper tests failed first in `pnpm --filter @forge/manager test -- src/features/coverage/enrich-selection.test.ts`, proving the old success path still returned `feedback: null` and redirected immediately.
- Green helper implementation moved accepted feedback into `apps/manager/src/features/enrich-selection.ts` with optional Jobs actions and made `apps/manager/src/features/coverage/enrich-selection.ts` re-export the actual helper used by the Coverage UI.
- Red pending-state test failed first in `pnpm --filter @forge/manager test -- src/features/coverage/enrich-action-controls.test.ts` because `EnrichActionControls` did not exist yet.
- Green UI implementation extracted `EnrichActionControls`, wired it into `CoverageReportClient`, added `isEnrichSubmitting`, disabled duplicate submits, and rendered pending/result status with the Jobs link.
- UX review hardening kept the cancel control available while a request is in flight, moved announcement responsibility to the existing parent live region, locked selection inputs during submit, and guarded late request responses after local cancel.
- `pnpm install --frozen-lockfile` was needed to refresh workspace symlinks after `origin/main` already expected `@forge/video-player` in Manager.
- Browser smoke used a temporary unauthenticated Next route under `/login/enrich-action-smoke` to render the real `EnrichActionControls` with Manager CSS. The route was removed after capture. Smoke evidence: `/tmp/forge-smoke/enrich-now-feedback-pending.png` and `/tmp/forge-smoke/enrich-now-feedback-accepted.png`.
- Local CMS data/auth was not used for the smoke run, so partial failure remains covered by focused unit tests rather than live data.

## Verification

Red first:

```bash
pnpm --filter @forge/manager test -- src/features/coverage/enrich-selection.test.ts
```

If a render/pending helper test is added, run that test red first as well.

Green after implementation:

```bash
pnpm --filter @forge/manager test -- src/features/coverage/enrich-selection.test.ts
pnpm --filter @forge/manager lint
pnpm --filter @forge/manager typecheck
git diff --check
```

Before PR, run the broader manager test suite if the change touches shared Coverage behavior beyond the action helper:

```bash
pnpm --filter @forge/manager test
```

## User Smoke Test

Use the real local Manager UI, not only unit tests.

1. Start or reuse local CMS and Manager dev servers with Manager auth configured.
2. Open `/dashboard/coverage`.
3. Select at least one language and one selectable video.
4. Click `Enrich Now`.
5. Confirm the button immediately changes to pending copy and cannot be clicked again while the request is pending.
6. Confirm the selection bar announces/prints a pending status.
7. Confirm a successful response shows accepted/started copy and a Jobs link.
8. Follow the Jobs link and confirm the created job appears on the Jobs surface.
9. If local data can produce a partial failure, confirm failed videos remain selected and the message reports both started and failed counts.
10. Capture smoke evidence in work notes or PR notes. If local data cannot produce partial failure, document the limitation and rely on the focused partial-failure test.

## Risks

- Auto-redirect can hide the accepted feedback before the user sees it. Prefer in-place feedback plus link for v1.
- Adding a global toast system would expand the fix unnecessarily. Keep feedback local to the selection bar.
- Slow `/api/enrich` preflight can still take time; the pending state must remain stable until the request settles.
- Existing tests may already have drift against helper copy. Do not paper over that; use the red phase to make the desired copy explicit.
- Local CMS data may not contain a convenient video/language combination for partial failure. Cover partial failure in unit tests and document smoke limitations if needed.

## References

- `apps/manager/src/features/coverage/coverage-report-client.tsx`
- `apps/manager/src/features/coverage/enrich-selection.ts`
- `apps/manager/src/features/coverage/enrich-selection.test.ts`
- `apps/manager/src/app/api/enrich/route.ts`
- `apps/manager/src/app/dashboard/jobs/new-job-form.tsx`
- `apps/manager/src/features/jobs/live-jobs-table.tsx`
- `apps/manager/src/app/globals.css`
- `docs/brainstorms/2026-04-11-enrich-now-feedback-brainstorm.md`
- `docs/roadmap/media-generation/feat-084-enrich-now-feedback.md`
