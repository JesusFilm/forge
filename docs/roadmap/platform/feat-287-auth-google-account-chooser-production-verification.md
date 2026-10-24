---
id: "feat-287"
title: "Auth Google Account Chooser Production Verification"
owner: "codex"
priority: "P1"
status: "not-started"
start_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-286"
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "google"
---

## Problem

The Google-hosted chooser and the full Auth-to-Admin callback cannot exercise
branch code before `feat-286` reaches the normal PR-to-main deployment. The
configuration and generated redirect can be proven pre-merge, but provider UI
and production callback behavior need a bounded post-deploy check.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-286-auth-google-account-chooser.md` — deployed
   implementation and pre-merge evidence.
2. `docs/solutions/auth/admin-sso-uses-oauth-local-session-not-shared-cookies.md`
   — canonical deployed Auth-to-Admin smoke path.

## Grep These

- `select_account`
- `Continue with Google`
- `consumeInteractivePrompt`
- `callbackURL`

## What To Build

1. Start without an active Jesus Film Auth session and with a Google session
   already active in the browser.
2. Click **Continue with Google** and confirm Google shows account selection,
   including the ability to use another account.
3. Select the intended identity and confirm the original Admin continuation
   completes.
4. Cancel once, retry, and confirm the chooser appears again.
5. Inspect the browser console for new errors and confirm no login-page loading
   regression.
6. Record the deployed revision and a redacted pass/fail result for each step in
   this ticket without storing account identifiers or OAuth request details.

## Constraints

- Use the deployed PR-to-main path; do not publish branch code directly.
- Do not persist full OAuth URLs, cookies, tokens, account email addresses, or
  other identifying details in the ticket evidence.
- `prompt=select_account` provides account choice, not fresh-authentication or
  unlocked-browser protection.

## Verification

- Record the deployed revision and a redacted pass/fail result for each step.
- If any step fails, reopen `feat-286` or create a narrowly scoped fix ticket
  before marking this follow-up complete.
