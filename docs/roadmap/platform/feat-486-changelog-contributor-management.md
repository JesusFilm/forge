---
id: "feat-486"
title: "Manage Changelog Contributors through Auth"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-11"
duration: 1
depends_on: []
blocks: []
tags:
  - "auth"
  - "changelog"
---

## Problem

Implement JesusFilm/jfp-changelog#129, part of #128. Changelog admins need to
list existing Contributors and revoke submission access in their environment.

## Entry Points — Read These First

- `apps/auth/src/services/changelog-oauth-grant.service.ts`: effective grants.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: native OAuth boundary.
- `apps/auth/src/services/changelog-production-access.service.ts`: operator grants.

## What To Build

An Auth-owned Contributor management HTTP boundary authenticated by an existing
Changelog OAuth credential. Bind the environment to the credential's seeded
client, recheck current actor authority, refuse effective Admin recipients, and
remove only Contributor scope from applicable grants. Preserve independent
Reader scopes, unrelated grants and existing OAuth lifetime/scope ceilings.
Changelog provides the administration screen and forwards the provider credential.

## Verification

Use disposable PostgreSQL and native management/OAuth handlers for credential,
authority, environment, grant-outcome and access-reduction coverage. Run Auth
tests, typechecking and lint; run Changelog page/action and auth regressions.

## Management contract

`GET /api/changelog/contributors?clientId=...` lists `{ environment, contributors }`.
`POST` accepts exactly `{ clientId, recipientId }` and returns `{ changed }`.
Both require a signed Auth website access JWT whose `azp`, `client_id`, resource
and environment bind it to the seeded local or production Changelog client.
Auth verifies `at+jwt`, issuer, audience, expiry, original Admin scope, live
session/membership/client and current Admin grants. ID tokens and dynamic MCP
credentials are refused. No supplied subject or cached role establishes authority.

Only `changelog:submit` scope associations in approved grants are removed.
Effective Admin recipients are refused, including promotion after list loading.
An environment lock and serializable transaction cover authority reads and writes.
Existing OAuth reduction and scope-ceiling policy remains in force.

## Results

Implemented the management boundary and paired Changelog administration UI.
All 596 Auth tests passed against disposable PostgreSQL with one shared test
signing secret; typechecking and Auth lint passed. The native OAuth suite covers
current authority, credential/environment attacks, mixed-scope revocation,
Admin promotion, stale exchange/refresh rejection and real lock contention.
Standards and Spec reviews passed after bounding database work below the
Changelog transport deadline. No production deployment was performed.

## PR #2252 review follow-up

Resolved finding #1: `SELECT ... FOR UPDATE` does not refresh a Serializable
snapshot. Management reads JWKS before locking the environment, so a production
operator could commit an Admin promotion while management waited and leave its
recipient check reading the old grants.

`apps/auth/src/services/changelog-production-access.service.ts` now updates
`app_environment.updated_at` when taking the lock for `grant-admin` or `revoke`.
That row write makes a waiting management transaction with an older snapshot
abort with PostgreSQL `40001`; the existing boundary returns `503`. A fresh
request then rejects the promoted Admin with `409`. Inspection retains its
read-only lock. Future production authority writers must preserve this row-write
protocol; merely moving the lock before JWKS cannot refresh a snapshot taken
while waiting for the lock.

The native OAuth integration regression queues the real operator before the
management request, observes both PostgreSQL lock waits, then releases them.
It failed before the fix (`200` instead of `503`) and passed afterward, including
the fresh `409` response and unchanged Admin/Contributor scopes. Only the
production configuration gate is switchable in the test; OAuth, HTTP handlers,
operator logic, and persistence are real. All 597 Auth tests pass against
disposable PostgreSQL; Auth typechecking, lint, and touched-file formatting pass.

### Additional local scenario verification

Expanded the native concurrency test to three cases:

- Recipient promotion: stale management returns `503`, fresh retry returns
  `409`, both scopes remain, and no Contributor-revocation audit is written.
- Actor revocation: stale management returns `503`, fresh retry returns `403`,
  the recipient retains Contributor scope, and no revocation audit is written.
- Read-only inspection: management returns `200`, the repeated request reports
  `changed: false`, exactly one revocation audit exists, and the environment
  timestamp stays unchanged.

All 599 Auth tests passed on a fresh disposable PostgreSQL 18 database with all
migrations applied. Each concurrency case passed five additional runs (15 case
executions). Existing native coverage also passed for mixed grants, protected
Admins, stale sessions/credentials, environment substitution, lock timeout,
and stale authorization-code/refresh rejection. Auth typecheck, lint, and
changed-file formatting passed. This is backend handler and persistence
verification; the paired Changelog browser UI was not exercised here.
