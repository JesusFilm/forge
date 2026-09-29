---
id: "feat-567"
title: "Serve the shared Changelog People directory from Auth"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 1
depends_on: []
blocks: []
tags: ["auth", "changelog"]
---

## Problem

Implement the Auth portion of [JesusFilm/jfp-changelog#154](https://github.com/JesusFilm/jfp-changelog/issues/154).
The Contributor-only management list does not give Readers and Contributors a
shared directory or show former grant holders and eligible preapprovals.

## Entry Points — Read These First

- `apps/auth/src/services/changelog-contributors.service.ts`: live access check.
- `apps/auth/src/services/changelog-people.service.ts`: directory selection.
- `apps/auth/src/app/api/changelog/people/route.ts`: HTTP contract.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: issued credential and disposable database test.

## Grep These

- `withChangelogAdmin`, `AppGrant`, `ChangelogPreapproval`

## What to build

Return active human accounts with a current or previous grant in the selected
Changelog environment and pending or expired eligible Contributor preapprovals.
Require the requesting viewer's current access. Associate a preapproval only
with a current verified address and expose whether it blocks later direct role
management. Keep Contributor management endpoints compatible.

## Constraints

Do not create access from an Auth account or an unredeemed approval. Do not
change production grants or deploy this work.

## Verification

Run the Auth typecheck, lint, full test suite, and the HTTP integration test
with issued credentials against a disposable migrated PostgreSQL database.
