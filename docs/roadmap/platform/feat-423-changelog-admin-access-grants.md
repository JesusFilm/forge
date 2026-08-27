---
id: "feat-423"
title: "Grant local Changelog Reader access by command"
owner: "edmonday"
priority: "P0"
status: "in-progress"
start_date: "2026-08-27"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "auth"
  - "oauth"
  - "access-control"
  - "developer-tooling"
---

## Problem

Local Changelog uses hosted Jesus Film Auth by default and requires an explicit Local `changelog:read` grant. Developers currently receive an insufficient-scope denial, and Forge has no supported command for provisioning that grant.

## Entry Points — Read These First

1. `docs/plans/2026-08-26-1702-feat-changelog-admin-grants-plan.md` — narrowed implementation-ready plan.
2. `apps/admin/src/scripts/grant-manager-operator.ts` — existing email-driven operator-command precedent.
3. `apps/auth/src/services/changelog-oauth-grant.service.ts` — current authorization, exchange, and refresh grant decision.
4. `apps/auth/src/domain/apps.ts` — canonical Changelog Local application environment.
5. `apps/auth/prisma/schema.prisma` — existing user, grant, scope, and audit models.
6. `apps/auth/src/services/audit.service.ts` — audit construction and target hashing.

## Grep These

- `CHANGELOG_APP_KEY|CHANGELOG_LOCAL_CLIENT_ID`
- `AppGrant|AppGrantScope|AuthAuditEvent`
- `emailVerified|membershipStatus|actorType`
- `changelog:read|AUTH_CHANGELOG_PRODUCTION_ENABLED`
- `manager:grant-operator`

## What To Build

1. Add a Forge Auth command that prompts for one exact email and grants Reader access only for the registered Changelog Local environment.
2. Require an existing verified ACTIVE HUMAN Auth user. Use email only to find the stable user ID, including for Google sign-ins.
3. Make the operation idempotent and preserve existing Local Contributor or Admin access.
4. Serialize concurrent attempts, then create the approved Reader grant and Auth audit event atomically while preserving historical rows.
5. Add no environment or role option that could grant Production or broader access.
6. Document a read-only, explicit Railway target preflight, required human confirmation, and `railway run` path for hosted Auth without inspecting, copying, or printing environment variables or `DATABASE_URL`.
7. Verify that reconnecting produces `changelog:read` for `http://localhost:3000/mcp` without Production, submit, or admin scopes.

## Constraints

- Do not build or depend on the Forge Admin dashboard.
- Do not add an Auth HTTP API or service bearer.
- Do not derive Reader access automatically from membership.
- Do not add a schema migration.
- Do not create users or identify grants by email.
- Do not add Contributor, Admin, Production, bulk, or revoke operations in this slice.
- Do not enable production Changelog issuance.
- Do not modify the Changelog repository; documentation follow-up remains [JesusFilm/jfp-changelog#81](https://github.com/JesusFilm/jfp-changelog/issues/81).

## Verification

- Service tests prove verified ACTIVE HUMAN eligibility, exact Local Reader persistence, idempotency, higher-role preservation, atomic audit, and Production isolation.
- Command tests prove prompted one-email input, redacted output/errors, and no environment or role selection path.
- Full Auth tests, typecheck, lint, touched-scope format checks, and `git diff --check` pass.
- After merge and deployment, a dedicated user reconnects through hosted Auth and can call the local Changelog MCP with `changelog:read` only. This manual hosted smoke is still required; this ticket does not claim it has already run.
- Production issuance remains disabled.
