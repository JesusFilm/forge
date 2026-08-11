---
id: "feat-349"
title: "Mobile login via hosted auth page"
owner: "urim"
priority: "P1"
status: "in-progress"
start_date: "2026-08-12"
duration: 5
depends_on: []
blocks: []
tags:
  - "mobile"
  - "infrastructure"
---

## Problem

The mobile app maintains three native sign-in flows (Apple sheet, email form, hosted-page fallback) plus a dormant native Google flow blocked on OAuth client provisioning. The hosted auth page already owns every method for web and admin. Each future auth capability (passkeys, two-factor) would need native work per app, per platform, per release. Consolidate: make the hosted page the only mobile login, opened in an in-app system browser sheet.

The full Product Contract (requirements R1-R9, flows, acceptance examples, settled decisions) is in `docs/plans/2026-08-11-001-feat-mobile-hosted-auth-login-plan.md`.

## Entry Points — Read These First

1. `docs/plans/2026-08-11-001-feat-mobile-hosted-auth-login-plan.md` — the Product Contract; read before any code.
2. `apps/mobile/src/lib/authActions.ts` — `signInWithHostedPage()` is the flow to promote; `signInWithApple`/`signInWithGoogle`/`signInWithEmail` are the flows to delete.
3. `apps/mobile/app/sign-in.tsx` — the native sheet route to remove.
4. `apps/mobile/src/lib/authSession.ts` — Better Auth Expo client + SecureStore session store; gained `readSession()` and the session/user creation stamps additively (plan KTD3/KTD6); its store, SecureStore adapter, and JWT single-flight contract are otherwise unchanged.
5. `apps/mobile/src/lib/accountDeletion.ts` — fresh-session re-auth must reroute through the hosted sheet.
6. `apps/auth/src/auth/config.ts` — the `jfp` self-RP provider carrying the flow; context only, do not edit.

## Grep These

- `signInWithHostedPage` — the surviving flow and its call sites
- `signInWithApple|signInWithGoogle|signInWithEmail|signUpWithEmail` — flows to remove
- `/sign-in` — router pushes to the sheet route; every hit becomes a direct hosted-flow launch
- `expo-apple-authentication|@react-native-google-signin` — dependencies and `app.json` plugin entries to drop
- `CANCEL_CODES` — native provider cancel codes in `authFlows.ts`, removed with the native flows. A hosted-flow cancel never throws: the expo plugin settles without a session, so cancel = session-less settle, and a thrown browser open classifies retryable.

## What To Build

- Point every sign-in entry at `signInWithHostedPage` directly (no landing screen); delete the `sign-in.tsx` route and handle stale deep links to it.
- Delete the native Apple, Google, and email flows, `EmailAuthForm`, and the `expo-apple-authentication` / `@react-native-google-signin/google-signin` dependencies and plugin entries.
- Guarantee a fresh login form after sign-out (mechanism per plan Outstanding Questions: ephemeral session vs `prompt=login`; Android Custom Tabs share Chrome cookies, so a prompt-style mechanism is likely required).
- Reroute account-deletion re-auth through the hosted sheet and keep its fresh-session contract.

## Constraints

- `apps/auth` edits are limited to the approved carve-out (plan KTD1): `prompt: "login"` on the `jfp` provider in `apps/auth/src/auth/config.ts`, its config-test pin, and the R9 guideline-4.8 note in `apps/auth/CLAUDE.md`. Auth-side cleanup of orphaned native-mobile entry points is a separate follow-up.
- The additions to `authSession.ts` (`readSession()`, the session/user creation stamps) are additive only, per plan KTD3/KTD6. Do not otherwise change its store, SecureStore adapter, or JWT single-flight contract. Keep the operation-scoped JWT gate in `authHeaders.ts` unchanged.
- No dormant native fallback may remain (plan Key Decisions: no kill switch is accepted).
- The hosted page must keep Sign in with Apple enabled (App Store guideline 4.8); record this with auth operators.

## Verification

- `pnpm --filter @forge/mobile typecheck && pnpm --filter @forge/mobile test` — jest guards (JWT operation gate, `useVideoPlayer` allowlist) stay green.
- Simulator, iOS and Android: sign in via Google and via email through the sheet; cancel returns in place with no error; sign out then sign in shows the login form (account switch possible); stale-session deletion re-auths through the sheet and completes; watch progress records after hosted sign-in.
- Confirm `expo-apple-authentication` and `@react-native-google-signin/google-signin` are absent from `apps/mobile/package.json` and `app.json`.
