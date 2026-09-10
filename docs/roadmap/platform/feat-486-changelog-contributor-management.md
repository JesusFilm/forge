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
