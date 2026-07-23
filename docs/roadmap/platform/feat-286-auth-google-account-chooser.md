---
id: "feat-286"
title: "Auth Google Account Chooser"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-22"
duration: 1
depends_on: []
blocks:
  - "feat-287"
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "google"
---

## Problem

When a browser has one active Google session, the shared Jesus Film Auth login
can send that account directly to Google's consent screen. A user who intended
to use a different personal or company account has no reliable account-switch
step and can request access for the wrong identity.

## Entry Points — Read These First

1. `apps/auth/src/auth/config.ts` — Better Auth social-provider configuration.
2. `apps/auth/src/app/login/login-page-client.tsx` — shared provider buttons
   and social sign-in request.
3. `apps/auth/src/app/api/auth/[...all]/route.ts` — OAuth continuation and
   first-party interactive-prompt consumption.
4. `docs/solutions/architecture-patterns/post-sign-out-force-login-marker-oidc-relying-apps.md`
   — distinction between first-party `prompt=login` and upstream IdP behavior.

## Grep These

- `socialProviders`
- `GOOGLE_CLIENT_ID`
- `sign-in/social`
- `select_account`
- `consumeInteractivePrompt`

## What To Build

1. Configure the Better Auth Google provider with `prompt: "select_account"`.
2. Apply the behavior globally so every shared Auth Google sign-in shows the
   Google account chooser before consent.
3. Add focused regression evidence for the Google provider configuration.
4. Verify the generated Google authorization URL before merge. Track the live
   Auth-to-Admin browser proof after deployment in `feat-287`.

## Constraints

- Do not restrict Google sign-in to a Workspace domain.
- Do not use `prompt=login`, `login_hint`, or an Admin-only workaround as a
  substitute for the upstream Google account chooser.
- Do not change Facebook, Apple, Okta, account-linking semantics, first-party
  OAuth callbacks, schemas, or generated GraphQL artifacts. Google
  account-linking authorization may inherit the provider-level chooser UI.

## Verification

- `pnpm --filter @forge/auth test`
- `pnpm --filter @forge/auth typecheck`
- `pnpm --filter @forge/auth lint`
- Inspect the Google authorization redirect for `prompt=select_account`.
- Post-deploy browser smoke is tracked in `feat-287` because branch code cannot
  be exercised through the deployed Google OAuth flow before merge.

## Completion Evidence

- Focused proof failed before implementation because Google's captured provider
  configuration omitted `prompt`, then passed after the provider option landed.
- The focused test feeds Forge's captured Google configuration through Better
  Auth's real Google authorization URL builder and asserts
  `prompt=select_account` on the generated URL.
- Auth tests, typecheck, and lint pass. Provider-hosted UI and the deployed
  Admin return remain intentionally tracked in dependent `feat-287`.
