---
id: "feat-565"
title: "Serve current Changelog permissions to protected consumers"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-29"
duration: 1
depends_on:
  - "feat-399"
blocks: []
tags:
  - "auth"
  - "changelog"
  - "security"
---

## Problem

JesusFilm/jfp-changelog#152 requires a previously issued website credential to
observe grant reductions on the next protected request. Token issuance and
refresh validation alone cannot enforce this for an already open session.

## Contract

`GET /api/changelog/current-permission?clientId=<seeded Changelog client>`
requires an Auth-issued bearer access token. A successful response is
`{ subject, clientId, environment, scopes }` with `Cache-Control: no-store`.
The three Changelog scopes reflect current Auth grants intersected with the
token's issued scope ceiling. An empty array means No Access. The selected
client binds the local or production environment; dynamic MCP tokens must have
matching signed audience, app, and environment claims. Errors are fixed codes:
400 malformed request, 401 invalid credential, 403 inactive or unavailable
authority, and 503 temporary inability to establish permission.

Grant writers must retain the environment-row lock so a permission reduction
committed before a lookup starts is visible to that lookup. Consumers must
validate subject, client, environment, scopes, and their own credential ceiling;
they must fail closed on errors without falling back to cached rights.

## Verification and rollout

The native Changelog OAuth integration suite uses a disposable PostgreSQL
database and issued OAuth credentials to cover reductions, environment
binding, credential scope ceilings, inactive membership, account expiry,
reactivation, and temporary failure. Auth must deploy before its Changelog
consumer. This work does not deploy either service or change production grants.
