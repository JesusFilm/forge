---
id: "feat-534"
title: "Activate preapproved Changelog memberships"
owner: "edmondshen"
priority: "P1"
status: "complete"
start_date: "2026-09-23"
duration: 1
depends_on: ["feat-532"]
blocks: []
tags: ["auth", "changelog"]
---

## Problem

Implement JesusFilm/jfp-changelog#132. A preapproved new Google recipient or
existing INVITED recipient must complete first website/MCP authorization without
operator membership provisioning.

## Entry Points

- `apps/auth/src/services/changelog-preapproval-redemption.service.ts`: atomic redemption.
- `apps/auth/src/services/changelog-oauth-grant.service.ts`: membership and grant evaluation.
- `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: native OAuth and management seams.

## What To Build

Allow INVITED HUMAN membership activation only within successful redemption,
after all existing evidence, authority, environment and approval checks. Read
authoritative membership after redemption before deciding access. Preserve
existing account linking, stable-user grant ownership and subsequent sign-in.

## Constraints

Never reactivate SUSPENDED/DISABLED users, widen scope or activate through an
unrelated app. No partial activation on failure. No deployment or schema change.

## Verification

Test the issue's pre-agreed native management/OAuth seams with disposable
PostgreSQL and signed Google fixtures: new/INVITED/ACTIVE website and MCP flows,
denial persistence, rollback, concurrency and unchanged linking safeguards.
Run focused tests and typechecks, then all Auth tests, lint and formatting.
Review Standards and Spec sequentially against starting commit `4583c4ece`.

## Implementation and verification

The existing Serializable redemption operation now accepts INVITED HUMAN users
and activates them only after validating all eligible approvals and current
approver authority. The membership update shares the transaction with grant
issuance, approval consumption and audit. No migration or management API change
is needed. Google signup and account linking continue through Better Auth.

Authorization reads membership from persistence after redemption, before grant
evaluation. This read is required even when redemption does nothing: a stale
ACTIVE cookie must not authorize a now-suspended recipient, and an INVITED cookie
must not block a newly activated recipient. Code exchange and refresh retain
their existing membership checks and scope ceilings.

- All 686 Auth tests passed in 55 files, including 72 native Changelog lifecycle
  cases against a dedicated disposable PostgreSQL 18 database with every migration
  applied. The Google boundary uses signed tokens and a test JWKS.
- The new-account website test failed with `access_denied` before implementation
  and passed afterward. The final matrix covers new, INVITED and ACTIVE accounts
  through browser Google callbacks and first website/MCP token issuance, including
  the original cached cookies and management visibility.
- Denial, rollback, concurrent redemption, suspension, approver loss, cancellation,
  linked-password continuity, reinstatement and production isolation now also
  exercise INVITED recipients. Existing linking, stale-code and refresh tests pass.
- Typecheck, lint and changed-file formatting passed. The full suite ran with
  `AUTH_TEST_DATABASE_URL` pointing to the disposable database, a shared test-only
  `BETTER_AUTH_SECRET`, and `vitest run --no-file-parallelism`.

## Review

Standards and Spec reviewed sequentially per the invoking repository's tool map,
against `4583c4ece` and JesusFilm/jfp-changelog#132. Standards review found duplicate
browser callback test setup; it now uses the shared Google fixture. The affected
tests were rerun after consolidation. No remaining findings on either axis.

Compound evaluation: no separate learning document. The transaction boundary and
fresh-membership rationale are captured in service comments, regression tests
and this ticket. No production deployment or live Google smoke was performed;
the full first-contribution acceptance journey remains #133.
