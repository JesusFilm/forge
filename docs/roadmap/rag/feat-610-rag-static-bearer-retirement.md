---
id: "feat-610"
title: "Retire Forge RAG static Railway bearer tokens"
owner: "jaco"
priority: "P1"
status: "in-progress"
start_date: "2026-10-06"
duration: 1
depends_on: ["feat-529", "feat-593"]
blocks: []
tags: ["rag", "auth", "operations", "retirement"]
---

## Problem

Forge RAG still accepts the static `SERVE_BEARER_TOKENS` Railway token map and
requires it at startup, even though registered consumer credentials now serve
the active callers. Removing the Railway variable before changing the code would
stop the service.

## Owner-reported cutover decision — October 6, 2026

Jaco reports that the seven-day registration period was completed, the team was
notified with instructions for the portal-based consumer approach, and October 6
is the announced decommission date. Current consumers have independently
reported working retrieval, with distinct request counts increasing in the
portal. These are owner reports, not a fresh production measurement by this PR.

## Scope

1. Require the existing registered consumer auth reader for serving and remove
   static token parsing, lookup, and startup validation. Preserve the `/v1`
   Bearer header, per-consumer source grants, usage attribution, portal, and
   restricted database roles.
2. Verify registered search, source intersection, invalid/revoked-key denial,
   auth-store failure, body limits, usage, and portal behavior with synthetic
   credentials. Ensure an old static token receives HTTP 401. After deployment,
   check actual `ragbot`, `website-factory`, and `seeker` retrieval and usage;
   do not change Seeker's separate `SEEKER_RAG_*` configuration in this cutover.
3. Update current operator documentation and examples. After the merged build
   is healthy, the operator removes `SERVE_BEARER_TOKENS` from
   `forge/production/@forge/rag` and retires old caller-side copies. Record the
   deployment and redacted verification without exposing credential values.

The old tokens lose authorization when the registered-only build is deployed;
removing the Railway value then prevents an accidental return of the old map.
The value's removal alone is not the first cutover step because the pre-cutoff
build requires it at startup.

## Cutover constraint

Production deploys use the normal PR-to-main Railway autodeploy path. This PR
does not mutate Railway settings. Do not remove the variable before the new
build starts successfully. Do not revoke registered consumer credentials,
remove their database roles, or restore static-token access during rollback.

## Completion gate

The merged registered-only build is healthy, registered consumers and portal
remain working with attributed usage, the old static token is denied, and the
Railway variable and old copies are removed with a redacted operator receipt.
Keep this ticket in progress until those live outcomes are recorded.

Implementation PR: [#2582](https://github.com/JesusFilm/forge/pull/2582).
The PR removes the code path and records the operator sequence; it does not
itself remove a Railway setting or establish the live completion gate.
