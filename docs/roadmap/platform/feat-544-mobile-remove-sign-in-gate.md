---
id: "feat-544"
title: "Remove the mobile sign-in gate when accounts open"
owner: "urim"
priority: "P2"
status: "not-started"
start_date: "2026-11-02"
duration: 1
depends_on:
  - "feat-543"
blocks: []
tags:
  - "mobile"
  - "platform"
---

## Problem

feat-543 hides the two signed-out sign-in entry points on mobile, the Profile card and the watch-page nudge, behind `EXPO_PUBLIC_SIGN_IN_ENABLED`. The gate is scaffolding for one phase: it exists only until the team opens accounts on mobile. After that, the gate is dead code, a second place to change sign-in copy, and a source of two accepted problems. A signed-in tester sees the disabled card for a moment after a cold launch, and a tester whose session expires cannot sign in again or delete the account in the app.

The start date is an estimate. The trigger is the step 0 decision below, not the date.

This ticket deletes the gate. It does not open the gate. To open sign-in for one environment without a code change, set `EXPO_PUBLIC_SIGN_IN_ENABLED=1` in that EAS environment and publish, as `apps/mobile/CLAUDE.md` ("Auth + watch progress") describes.

## Entry Points — Read These First

1. `docs/plans/2026-09-23-1104-feat-mobile-sign-in-gate-plan.md`: the plan that added the gate. Read the Scope Boundaries and the Risks.
2. `apps/mobile/src/lib/signInGate.ts` and `apps/mobile/src/lib/signInGateState.ts`: the predicate and its rule.
3. `apps/mobile/src/components/profile/AccountSection.tsx`: the signed-out branch renders the disabled card while the gate is closed.
4. `apps/mobile/src/components/watch/SignInPrompt.tsx`: `SignInPrompt` is a thin gate around `SignInPromptBanner`.
5. `apps/mobile/src/lib/__tests__/signInGateWiring.guard.test.js`: the source guard. Rule 5 is not gate-specific (see KEEP list).

## Grep These

The greps are the source of truth, not the file list above. The code will move before this ticket starts.

```bash
git grep -nE 'EXPO_PUBLIC_SIGN_IN_ENABLED' -- apps/mobile
git grep -nE 'isSignInAvailable|resolveSignInAvailable|signInGate' -- apps/mobile
git grep -nE 'Sign in \(Coming soon\)|Accounts are not available yet' -- apps/mobile
git grep -nE 'feat-543' -- apps/mobile
```

Each line is an independent literal family: the env name, the symbols, the copy, and the ticket ID. One rename cannot empty all four. Do not grep for `Coming soon` alone: `src/components/ui/PlaceholderScreen.tsx` uses it for another purpose. Do not add `\b` to a pattern: `git grep -E` on macOS does not support it, and the pattern then matches nothing.

**Rename covenant.** A pull request that renames a grepped symbol, the variable, or the copy must update these patterns in the same pull request. Otherwise a grep returns nothing and reads as "already removed".

## What To Build

**Do not `git revert` the feat-543 pull request.** The code will have moved, and that pull request also carries this ticket, the CONCEPTS.md "Sign-In Gate" entry that TV's feat-322 gate still uses, and guard Rule 5.

### Step 0 — precondition

The mobile owner decides that accounts are open on mobile in every environment. The removal opens sign-in on every build that carries it. If only some environments should open, set the variable in those environments instead, and do not start this ticket.

### Step 1 — delete the gate

For each grep hit, delete the gate and keep the open path:

- The predicate, the rule, and their suites: `signInGate.ts`, `signInGateState.ts`, and the tests beside them.
- The three registrations in `apps/mobile/src/env.ts` (`_inlined`, `client`, `runtimeEnvStrict`), the sign-in cases in `apps/mobile/src/__tests__/env.test.ts`, and the block in `apps/mobile/.env.example`.
- The disabled card in `AccountSection.tsx`: the signed-out branch renders only the live "Sign in" card.
- The thin gate in `SignInPrompt.tsx`: `SignInPrompt` renders the banner directly again.
- The mutable gate holders and the gated cases in `AccountSection.test.tsx` and `SignInPrompt.test.tsx`. Keep every open-gate case.
- Rules 1 to 4 and the positive control in `signInGateWiring.guard.test.js`.
- The sign-in gate bullet in `apps/mobile/CLAUDE.md`.

### Step 2 — KEEP list (binding)

- The "Sign in again" step in `apps/mobile/src/components/profile/DeleteAccountFlow.tsx`. It was never gated.
- The nudge's arming, cooldown, and per-session cap in `apps/mobile/src/lib/watchProgress/signInPrompt.ts`, and the banner body in `SignInPrompt.tsx`.
- The live Profile card: its sign-in handler, busy state, error card, and `dd-action-name` `profile-sign-in`.
- `signInWithHostedPage` in `apps/mobile/src/lib/authActions.ts`.
- Guard Rule 5: only `src/lib/authActions.ts` calls the auth client's sign-in methods. Keep it in a guard of its own, or keep the file with that rule only and a new header.
- The CONCEPTS.md "Sign-In Gate" entry. TV's `EXPO_PUBLIC_TV_PROFILE_ENABLED` is still a sign-in gate. Remove only mobile-specific wording, if any.
- Everything in `apps/tv`. This ticket does not change the TV gate.

### Step 3 — prose sweep

Follow `docs/solutions/workflow-issues/mechanism-retirement-docs-prose-sweep.md`:

```bash
git grep -niE 'EXPO_PUBLIC_SIGN_IN_ENABLED|isSignInAvailable|sign-in gate|Coming soon\)|feat-543' -- '*.md'
```

Check CONCEPTS.md "Sign-In Gate", `apps/mobile/CLAUDE.md`, and `docs/roadmap/`. Classify each hit by its content. Leave a historical record as it is. Put a dated supersession note next to an instruction that still names the gate as live.

### Step 4 — operator teardown (no merged pull request can do this)

After the removal build reaches testers, delete `EXPO_PUBLIC_SIGN_IN_ENABLED` from every EAS environment (development, preview, production) with the EAS dashboard or `eas env:delete`. A value that remains is inert once the code stops reading it, so the order is forgiving.

## Constraints

- JavaScript only. Do not edit `eas.json`, add a native module, or add a config plugin. The removal must not move the fingerprint runtime version.
- No change to web, TV, or auth.
- Known issue to carry forward, not to fix here: in account deletion, "Cancel" after a sign-in to the wrong account leaves the tester signed in to that account. The gate made recovery harder. After removal, the tester can sign out and sign in again.

## Verification

- Every grep in "Grep These" returns nothing.
- `pnpm --filter @forge/mobile test`, `pnpm --filter @forge/mobile typecheck`, and `pnpm --filter @forge/mobile lint` pass.
- Guard Rule 5 still runs and passes.
- In `apps/mobile`, `npx expo-updates runtimeversion:resolve --platform ios` and `--platform android` return the same value on the merge-base and on the branch head.
- On a non-development build with no EAS value set, a signed-out tester sees the live "Sign in" card, and a tap opens the hosted sign-in page.
- The prose sweep in step 3 finds no forward-looking instruction that names the gate as live.
- The operator step 4 is done in every EAS environment.
