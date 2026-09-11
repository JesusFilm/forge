---
id: "feat-489"
title: "Manage Changelog Contributor preapprovals"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-11"
duration: 1
depends_on: []
blocks: []
tags: ["auth", "changelog"]
---

## Problem

Implement JesusFilm/jfp-changelog#130 (parent #128). Auth owns individual
Contributor preapprovals before signup; creation must never issue access.

## Entry Points

- `apps/auth/src/services/changelog-contributors.service.ts`: authenticated management boundary.
- `apps/auth/prisma/schema.prisma`: durable approval lifecycle.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: native HTTP/OAuth tests.

## What To Build

Reuse current actor and environment checks for list/create/cancel/renew.
Normalize individual emails with trim/lowercase. Preserve redemption fields for
#131. Thirty-day expiration uses an exclusive upper boundary. Creation IDs and
version checks make retries safe and prevent stale actions overwriting renewals.
Cancel unused approvals when the current approver loses applicable authority,
including membership and scope changes. Renewal transfers approver ownership.

## Verification

Run public handler integration tests on disposable PostgreSQL, Auth typecheck,
lint and full tests. The paired Changelog change exercises page/action seams.

## Contract and persistence

`GET /api/changelog/preapprovals?clientId=...` returns `{ environment, preapprovals }`.
`POST` accepts exactly `{ clientId, action: "create", id, email }` or
`{ clientId, action: "cancel" | "renew", id, version }`. All operations reuse
`withChangelogAdmin`, including signed website credential validation, live
session/membership and Admin grant checks, environment locking and Serializable
isolation. Management never activates membership or creates grants.

Create IDs identify retries. Updates require the displayed version; stale and
redeemed operations return 409. Serialization conflicts return 503 and must be
retried or reloaded without changing the request's version. Renewal transfers
current approval ownership and starts a new 30-day period. State is expired at
`now >= expiresAt`; expiration is derived rather than relying on a scheduled job.

`20260911000100_preapproval_authority/migration.sql` cancels pending records at
transaction commit after membership, grant, scope or environment authority loss.
Authority writers touch the environment row to invalidate older management
snapshots. Deferred checks observe final transaction authority, allowing atomic
scope replacements. Historical user IDs survive account deletion. The migration
also constrains state/version/redemption fields and indexes unused records.

**Redemption requirement for #131:** recheck current approver authority, exact
application/environment, expiry and recipient eligibility inside the redemption
transaction. Do not treat pending state alone as authorization, even with these
cancellation triggers. Management cannot renew a redeemed record.

Deploy both Auth migrations and the endpoint before the paired Changelog UI.
No production changes were made by this implementation.

## Verification results

- Auth: all 603 tests passed (53 files), with disposable PostgreSQL 18 and all
  migrations applied; typecheck and lint passed.
- Changelog: all 349 tests passed (25 files), including 57 administration tests;
  typechecking and touched-file formatting passed.
- Native management tests cover creation before signup, replay, exact expiration,
  cancel/renew version conflicts, competing updates, transfer to a second admin,
  membership/grant/scope loss, terminal redeemed fixtures and denied requests.
- Existing native OAuth and Contributor management regressions pass, including
  authority changes under real PostgreSQL lock contention.
- Standards and Spec review completed against the #129 merge foundations.
  Corrected unnecessary environment invalidation on Contributor-scope removal;
  the original read-only inspection/concurrent revocation regression passes.
- PR #2254 CI repair: replaced the backtracking email regex with linear string
  checks while preserving validation behavior. Added 16 request validation tests;
  585 local Auth tests passed, with 34 database integration tests skipped locally.
  Typecheck, lint and touched-file formatting passed. Wrapped the original commit
  message to satisfy commitlint's footer line limit.
