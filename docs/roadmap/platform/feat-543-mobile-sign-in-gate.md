---
id: "feat-543"
title: "Mobile sign-in gate hides sign-in until an environment turns it on"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-09-23"
duration: 2
depends_on: []
blocks:
  - "feat-544"
tags:
  - "mobile"
  - "platform"
---

## Problem

The team wants mobile sign-in hidden until further notice, but every installed TestFlight build offers it. A signed-out viewer can open the hosted sign-in page from the Profile tab, and from a nudge that appears after they stop a video past 30 seconds. Mobile has no switch that can hide it.

## Entry Points — Read These First

1. `docs/plans/2026-09-23-1104-feat-mobile-sign-in-gate-plan.md` — the plan. It carries R1-R11 and AE1-AE10, and it is the authority for every decision below.
2. `apps/tv/src/lib/auth/profileFlagState.ts` and `apps/tv/src/lib/auth/profileFlag.ts` — the TV rule from feat-322 that this gate copies. The test file beside them holds the truth table.
3. `apps/mobile/src/components/profile/AccountSection.tsx` — the signed-out Profile card (entry point 1). Line 58 splits signed-in from signed-out.
4. `apps/mobile/src/components/watch/SignInPrompt.tsx` and `apps/mobile/src/lib/watchProgress/signInPrompt.ts` — the watch-page nudge (entry point 2).
5. `apps/mobile/src/components/profile/DeleteAccountFlow.tsx` — "Sign in again" before deletion (entry point 3). It stays ungated.
6. `apps/mobile/src/env.ts` — the env schema. A new opt-in variable is `.optional()`.

## Grep These

- `signInWithHostedPage` — exactly three non-test callers, one per entry point
- `EXPO_PUBLIC_TV_PROFILE_ENABLED` — the TV variable to mirror
- `resolveProfileSurfaceEnabled` — the TV resolver
- `SIGN_IN_PROMPT_COPY` — the nudge copy
- `Keep your place across devices` — the subtitle that R5 replaces

## What To Build

- One opt-in `EXPO_PUBLIC` variable, read through a pure resolver with the TV rule: `__DEV__` always on, otherwise on only for `1` or `true`.
- While the gate is closed, the signed-out Profile card is disabled and reads "Sign in (Coming soon)" and "Accounts are not available yet" (R5, R6).
- While the gate is closed, the watch-page nudge never appears (R7).
- Nothing changes for a signed-in tester, including "Sign in again" before deletion (R8, R9).

## Constraints

- No LaunchDarkly SDK, no new dependency, and no change to web, TV, auth, or `packages/feature-flags`.
- Fail closed: any value other than `1` or `true` hides sign-in (R2).
- The gate value is known before the first render. No surface may show the live card and then change to the disabled one (R4).
- The gate is phase-scoped scaffolding. The pull request that adds it also adds its removal ticket, feat-544 (`docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md`).
- The gate reaches installed builds only with the next native build, because the production OTA channel is dark.

## Verification

- `pnpm --filter @forge/mobile test` and `pnpm --filter @forge/mobile typecheck` pass.
- The resolver's truth table matches TV's: `__DEV__` always on; `1` and `true` on; absent, empty, `0`, `false`, and `TRUE` off.
- On a non-development build of each platform with no value set, the Profile card is disabled and no nudge appears after a pause past 30 seconds (AE1, AE3). A development build always shows sign-in (R3), so it cannot show this state.
- A signed-in tester can still sign out and complete account deletion, including "Sign in again" (AE5).
