---
id: "feat-599"
title: "Protected Android TV beta signup to Google Sheets"
owner: "ekkasit"
priority: "P1"
status: "complete"
start_date: "2026-09-28"
duration: 1
depends_on: []
blocks: []
tags: [tv, infrastructure]
---

## Problem

The beta guide needs to save Android tester emails after server-side human verification.

## Entry Points

- `apps/tv-feedback/src/app/api/beta-requests/route.ts`
- `apps/tv-feedback/src/server/betaRequests.ts`
- `apps/tv-feedback/public/beta/index.html`

## Constraints

Require Turnstile with `tv_beta_signup` action even in development. Use server-only Google credentials, RAW sheet writes, Redis rate limits and duplicate suppression. No automatic Google Play enrollment or invitation email.

## Verification

- 2026-09-28: Approved guide design and videos deployed to Railway staging (`e61b2d9a-34ae-44e6-a808-aa75937cd15f`). Both tutorial players and the request form opened successfully. Invalid Turnstile token returned HTTP 403. Videos support range requests and are loaded on demand. 23 tests and Next build passed.

- 2026-10-02: Consolidated against main after the feedback release. All 27 tests, TypeScript, lint and production build pass. Prior staging verification and the confirmed Pending row are recorded in `apps/tv-feedback/BETA-SIGNUP.md`; this cleanup did not submit another signup.
