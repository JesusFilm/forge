---
id: "feat-572"
title: "Change Changelog People roles safely"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 1
depends_on: ["feat-570", "feat-571"]
blocks: []
tags: ["auth", "changelog", "security"]
---

## Problem

Implement the Auth portion of [JesusFilm/jfp-changelog#156](https://github.com/JesusFilm/jfp-changelog/issues/156).
An Admin needs to assign one effective Changelog role without bypassing onboarding
or removing the last active Admin. Previously issued credentials must observe a
reduction on their next protected request.

## Entry points

- `apps/auth/src/app/api/changelog/people/role/route.ts`: mutation contract.
- `apps/auth/src/services/changelog-roles.service.ts`: eligibility, serialized
  grant change, preapproval blocker, and last-Admin check.
- `apps/auth/src/services/changelog-contributors.service.ts`: shared current-Admin
  authority boundary. The Contributor-only revocation route remains separate.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: native HTTP
  role and previously issued credential checks.

The role POST requires `expectedRole`, the role shown by People when the Admin
opened the form. Auth compares it with the effective role inside the grant
transaction and returns `409 role-changed` when another change won first.

## Verification

Run Auth typecheck, lint, the native HTTP integration suite against disposable
PostgreSQL, and the full Auth test suite. Changelog owns its People form and
action tests in the other repository. Do not deploy or change production grants
as part of this ticket.
