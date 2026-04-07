---
id: "feat-051"
title: "Public Report Role"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-04-13"
duration: 14
depends_on: []
blocks:
  - "feat-068"
tags:
  - "manager"
  - "auth"
  - "reports"
---

## Problem

Coverage and enrichment reports are currently locked behind authenticated Manager access, which makes it hard to share read-only reporting with stakeholders who should not need a full sign-in flow. We need a safe public or anonymous report path that exposes only reporting surfaces while keeping all write actions protected.

## Entry Points — Read These First

1. `apps/manager/src/lib/auth.ts` — current Strapi role lookup and role checks
2. `apps/manager/src/lib/require-auth.ts` — Manager-only gate used across the dashboard
3. `apps/manager/src/middleware.ts` — route protection entrypoint
4. `apps/manager/src/app/dashboard/layout.tsx` — current authenticated shell
5. `apps/manager/src/app/api/coverage-snapshots/route.ts` — existing report data endpoint
6. `apps/cms/schema.graphql` — Users & Permissions role surface already available from Strapi

## Grep These

- `Manager` in `apps/manager/src/lib/`
- `coverage-snapshots` in `apps/manager/src/app/api/`
- `auth` in `apps/manager/src/app/api/`
- `role` in `apps/manager/src/lib/auth.ts`

## What To Build

1. Define a read-only report access model for non-signed-in users or an equivalent public-report role.
2. Split report-readable routes from write or operator-only dashboard routes so anonymous access cannot trigger jobs or edit data.
3. Add explicit route-level checks for the public-report surface and keep Manager-only protections on everything else.
4. Decide whether public report URLs are globally accessible, tokenized, or environment-gated, and document that choice.
5. Make the report shell presentable without the authenticated dashboard chrome.

## Constraints

- Do NOT weaken existing job, settings, or data-mutation protections.
- Do NOT expose internal-only workflow details that belong in the operator dashboard.
- Keep the public surface read-only and cache-friendly.

## Verification

- Open a public report URL while signed out and confirm the report loads
- Confirm a signed-out user cannot access job creation, admin actions, or protected dashboard routes
- Confirm Manager users still see the full authenticated dashboard experience
