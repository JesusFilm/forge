---
id: "feat-068"
title: "Partner Publishing and User Accounts"
owner: "tataihono"
priority: "P2"
status: "not-started"
start_date: "2026-10-01"
duration: 61
depends_on:
  - "feat-051"
blocks:
  - "feat-070"
tags:
  - "platform"
  - "accounts"
  - "shared"
---

## Problem

This is shared work between Vlad and Tatai. External partners will need a bounded way to access publishing flows and account-based experiences without being treated like internal operators. The platform needs partner-aware accounts and publishing controls before broader public AI workflows can launch safely.

## Entry Points — Read These First

1. `docs/roadmap/platform/feat-051-public-report-role.md` — public/read-only access foundation
2. `apps/manager/src/lib/auth.ts` — current role lookup
3. `apps/manager/src/lib/require-auth.ts` — current Manager-only gate
4. `apps/manager/src/middleware.ts` — route protection surface
5. `apps/cms/schema.graphql` — user and role primitives already available from Strapi

## Grep These

- `Manager` in `apps/manager/src/lib/`
- `role` in `apps/cms/schema.graphql`
- `auth` in `apps/manager/src/app/api/`
- `middleware` in `apps/manager/src/`

## What To Build

1. Define partner account types, permissions, and publishing capabilities.
2. Separate partner-facing actions from internal-operator permissions.
3. Support account lifecycle basics needed for onboarding, role assignment, and revocation.
4. Keep the account model compatible with later public AI entry points and partner-specific publishing flows.

## Constraints

- Do NOT reuse the Manager role for partner access.
- Keep partner permissions narrow and auditable.
- Prefer explicit role boundaries over feature-flag spaghetti.

## Verification

- A partner account can access only its intended publishing surface
- Internal operator flows remain protected
- Role assignment and revocation work without manual database edits
