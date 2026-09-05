---
id: "feat-458"
title: "Operate Changelog production admin grants"
owner: "edmondshen"
priority: "P0"
status: "in-progress"
start_date: "2026-09-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "auth"
  - "changelog"
---

## Problem

JesusFilm/jfp-changelog#101 requires a supported production admin grant and
revocation workflow before activating Changelog production scope issuance.
Production currently has only the Local Reader operator command. The pilot
recipient is an existing verified, active human with a local grant and no
production grant. The production gate is unset and therefore disabled.

## Entry Points — Read These First

1. `apps/auth/src/services/changelog-local-reader-grant.service.ts`: existing
   transactional operator command precedent, environment locking and audit.
2. `apps/auth/src/services/changelog-oauth-grant.service.ts`: production gate,
   exact environment grant union, membership and lifecycle checks.
3. `apps/auth/src/services/changelog-oauth-grant.integration.test.ts`: native
   authorization-code and refresh revocation tests against disposable PostgreSQL.

## What To Build

Add `changelog:production-access` with `inspect`, `grant-admin`, and `revoke`
operations for an explicitly entered existing user email. This is a trusted
operator CLI using Auth database credentials, following the existing command
model, not a public endpoint or new authorization system.

- Fix the target to approved `jfp_changelog_production` in active `changelog`.
- Grant only to an email-verified, ACTIVE HUMAN. Never create identities or
  activate membership. Require the operator to verify the intended identity.
- Inspect returns membership, verification, stored production grant scopes,
  and non-secret IDs. No credentials, raw email, or connection strings in output.
- Grant Admin idempotently; preserve other grants and revoked history. Admin
  implies read and submit under the existing policy.
- Revoke all non-revoked Changelog production USER grants for the exact subject,
  including pending grants, so a union cannot retain access. Permit revocation
  for inactive subjects and disabled environments. Never touch local grants.
- Serialize grant/revoke with the existing environment row lock. Mutations and
  audit records commit together; audit the subject hash and operator command
  source. Do not introduce schema changes.
- Preserve the Local Reader command and production enablement gate unchanged.
- Verify provisioning, no-grant denial, environment isolation, revocation and
  repeat execution in isolated existing Auth integration boundaries before any
  real production grant or flag change. Reuse native OAuth lifecycle tests.

## Constraints

No new dashboard, general role management, direct production SQL writes, token
translation, test accounts in production, or revocation of the pilot admin for
testing. Already-issued JWTs retain their existing lifetime. Changes ship through
the normal PR-to-main flow; production access remains pending until that happens.

## Verification

Use the already-approved Auth grant-policy and OAuth integration test seams from
JesusFilm/jfp-changelog#100. Run focused tests during development, typecheck,
lint, and the full Auth suite with disposable PostgreSQL once at completion.
Document the supported command, isolated proof and production activation order.

Implementation and isolated validation are complete; the production release and
pilot acceptance remain pending. See `docs/auth-changelog-production-access.md`.
