---
title: "Email-first Auth login should route provider accounts before showing password"
category: auth
date: 2026-05-26
tags:
  - auth
  - login
  - oauth
  - better-auth
  - firebase
problem_type: best_practice
component: authentication
module: apps/auth
severity: medium
last_updated: 2026-05-26
---

## Context

Auth login supports both email/password and upstream OAuth providers. Showing the
password field immediately invites users with Google, Facebook, Apple, or Okta
accounts to try a password that may not exist for their Auth account.

## Guidance

Keep login email-first. After the user enters an email, ask Auth which configured
method should handle that address:

- If the account has a configured OAuth provider account, continue through the
  existing provider sign-in endpoint with the original OAuth authorize query.
- If the account has only password-compatible account records, no account, or an
  unconfigured provider, reveal the password field.
- Keep Firebase lazy migration on the password path. A migrated Firebase account
  may have a `firebase` account record, but that is not an upstream button and
  should not prevent password fallback.
- Signup may use legacy Firebase as an existence check, but it should return the
  same generic existing-account message as Auth-owned users. Do not migrate a
  Firebase account or reveal provider details during signup.
- Rate-limit the lookup endpoint and return the password path when throttled so
  provider probing cannot cheaply enumerate sign-in methods.
- Log only hashed email identifiers, matching the rest of Auth's sign-in audit
  posture.

## Why This Matters

The provider lookup and the final sign-in must stay separate. The lookup is a
UX routing hint; the existing Better Auth provider or email endpoints still own
the actual authentication, OAuth continuation, session cookies, and Firebase
migration behavior.

## When To Apply

Use this pattern for Auth login UI changes that need to route a user between
password and upstream SSO based on their email address.

## Related

- `apps/auth/src/app/api/auth/[...all]/route.ts`
- `apps/auth/src/app/login/login-page-client.tsx`
- `apps/auth/src/auth/login-methods.ts`
- `apps/auth/src/auth/firebase-rest.ts`
