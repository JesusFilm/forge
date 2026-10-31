---
id: "feat-918"
title: "Watch: batch account and progress bootstrap reads"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "infrastructure"
---

## Problem

Linear FGE-225 / W-028 originally reported four mount requests competing with
hydration/LCP. Exact main `a3a8f8796a8c25749c4cd02432397772dbf93cef` has retired
beta signup (feat-667) and behavioral profile initialization (feat-902).
Only the account session and signed-in progress reads survive. The owner
confirmed this two-read scope on October 30; no current runtime waterfall or
performance improvement has been measured. Original observer unknown.

This ticket was incoming PR #2647's feat-630. The parent reserved feat-918
exclusively after scanning retained open heads, reservations and worktrees;
the unrelated media-generation and topic-experiences feat-630 tickets remain.

## Entry Points — Read These First

1. `apps/web/src/app/api/bootstrap/route.ts`: `watch-bootstrap-v1`, one session
   verification, concurrent account gate evaluation, signed-in progress only,
   private/no-cache/no-store response and bootstrap-only 1.5 s progress abort.
   The shared response can wait up to that budget for progress.
2. `apps/web/src/lib/watch-bootstrap-contract.ts`: two nullable sections,
   `account` and `watchProgress`, parsed independently.
3. `apps/web/src/lib/watch-bootstrap-client.ts`: shared document flight;
   complete responses stay cached; unavailable sections retry on a later
   consumer load after a five-second cooldown, sharing one flight and retaining
   healthy siblings only with compatible identities. No automatic retry timer.
4. `apps/web/src/lib/account-session-response.ts`: shared response builder for
   bootstrap and the on-demand `/watch/api/auth/session` download check.
5. `apps/web/src/components/watch/AccountControl.tsx`: account menu, auth
   `returnTo`, cancellation, Datadog identify/clear.
6. `apps/web/src/lib/watch-progress-client.ts`: account-scoped storage,
   anonymous promotion, progress/history writes and session checks.

## Grep These

- `watch-bootstrap-v1`, `loadWatchBootstrap`, `buildAccountSessionBody`
- `BOOTSTRAP_PROGRESS_TIMEOUT_MS`, `AbortSignal.any`
- `forge.watch_progress.v1`, `identifyDatadogRumUser`, `clearDatadogRumUser`

## What To Build

Combine the two surviving initial reads in one shared bootstrap GET. Preserve
on-demand auth session checks and watch-progress GET/POST/DELETE. Omit the
retired beta section from the DTO/parser; do not replace it with another CTA.
Preserve authored/download CTAs and their existing account gate independently.
Remove the offered idle helper/tests used only by retired profile initialization.

The parent locally repaired R4-2647-1: bootstrap preserves compatibility-session
unavailability instead of caching it as a guest, partial sections can recover
through a bounded shared retry, and unavailable progress remains unknown until
a later consumer load. Healthy guest caching stays intact. Existing on-demand
auth callers retain their fail-closed anonymous response. Fresh independent
review, candidate CI and runtime/loading acceptance remain open; this is not
yet a published or complete repair.

## Constraints

- Preserve main's beta and profile retirement; no consent shell/banner or POST.
- Preserve configured GA and Datadog with no consent prerequisite.
- Keep visitor data out of static layouts/shared caches; never echo tokens.
- Preserve authenticated user/storage/write isolation and public language routes.
- Do not overwrite current feature flags, timeouts or operational docs.
- Request reduction is not a measured account-latency or loading improvement.

## Verification

Run focused bootstrap, account, progress, auth callback and CTA-retirement tests
with at most two workers, full Web typecheck, touched package/root lint/format,
and the new roadmap ID advisory against the staged candidate. See
`docs/plans/2026-10-30-fge-225-current-main-integration.md`.

Parent follow-up must include mounted compatibility failure/recovery and partial
200 recovery tests, healthy guest/signed-in cache and concurrent-flight controls.
Then verify a real non-production Watch document's requests and matched loading
metrics, auth navigation, user isolation and cache headers before completion.

## Local Recovery Evidence

- Real React consumers, the bootstrap Next handler, compatibility verifier,
  parser and loader are composed in JSDOM with controlled upstream boundaries.
  Six regressions fail on the frozen integration before the repair. Follow-up
  controls include invalid JSON and healthy anonymous compatibility responses.
- The initial JSDOM attempt hit the server environment proxy rather than the
  auth seam. The corrected harness supplies explicit validated test config;
  retained red evidence reaches the real verifier and reproduces the defect.
- Partial account recovery retains healthy same-user progress, concurrent
  consumers share retry flights, and a confirmed new account cannot inherit
  another user's cached progress. No real auth server or browser claim follows.
