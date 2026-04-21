---
id: "feat-102"
title: "Admin Login Copy Simplification"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-04-16"
duration: 1
depends_on:
  - "feat-091"
blocks: []
tags:
  - "platform"
  - "admin"
  - "ui"
  - "auth"
---

## Problem

The admin login screen carried too much operational and migration language for
a transparent sign-in path. Operators need a calmer entry point that identifies
Forge Admin plainly, uses familiar field labels, and avoids surfacing system
metadata that does not help them sign in.

## Entry Points — Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/app/login/login-page-client.tsx`
4. `apps/admin/src/i18n/messages.ts`
5. `apps/admin/src/app/login/page.ui.test.tsx`

## What To Build

1. Rename the login brand heading from Forge Editorial to Forge.
2. Replace the vague login hero line with mission-appropriate Forge Admin copy.
3. Remove system architecture, node status, secure channel, region, and legacy
   account messaging from the login screen.
4. Rename the email and password labels to user-facing language.

## Constraints

- Do not change auth behavior or API calls.
- Keep the update scoped to login UI markup, messages, and tests.
- Preserve existing i18n coverage for English and Spanish.

## Verification

- `pnpm --filter @forge/admin test -- src/app/login/page.ui.test.tsx`
