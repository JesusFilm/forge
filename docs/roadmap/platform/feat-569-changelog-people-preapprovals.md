---
id: "feat-569"
title: "Manage Contributor preapprovals in Changelog People"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 1
depends_on: ["feat-567"]
blocks: []
tags: ["auth", "changelog"]
---

## Problem

Implement the Auth portion of [JesusFilm/jfp-changelog#155](https://github.com/JesusFilm/jfp-changelog/issues/155).
The shared People directory shows pending and expired approvals but does not
offer inline management. An expired approval must be renewed before cancellation.

## Entry points

- `apps/auth/src/services/changelog-preapprovals.service.ts`: lifecycle operations.
- `apps/auth/src/app/api/changelog/preapprovals/route.ts`: HTTP contract.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: issued credential tests.

## Verification

Run Auth typecheck, lint, the lifecycle HTTP integration test against disposable
PostgreSQL, and the full Auth test suite. Changelog handles the People page and
server actions in its own repository.
