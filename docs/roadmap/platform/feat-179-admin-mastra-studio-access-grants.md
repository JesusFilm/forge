---
id: "feat-179"
title: "Admin Mastra Studio access grants"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-160"
blocks: []
tags:
  - "platform"
  - "admin"
  - "auth"
  - "mastra"
  - "access-control"
---

## Problem

The Admin Users table renders a Mastra Studio product-access dropdown, but the
control is disabled and marked mock-only. Operators need the same basic grant /
revoke behavior they already have for Manager, while keeping Mastra Studio
authorization owned by `apps/mastra-gateway`.

## Entry Points - Read These First

1. `apps/admin/src/app/dashboard/users/page.tsx` - Users screen product access controls and server actions.
2. `apps/admin/src/app/dashboard/ops-data.ts` - Users page data loader and row access model.
3. `apps/mastra-gateway/src/services/studio-access.service.ts` - Gateway-owned Studio access service contract.
4. `apps/mastra-gateway/src/services/studio-access.repository.ts` - Gateway Prisma persistence for `studio_access`.
5. `apps/mastra-gateway/prisma/schema.prisma` - `StudioAccess` table and email uniqueness.

## Grep These

- `MASTRA_STUDIO_ROLE_OPTIONS`
- `ProductAccessControl`
- `updateManagerAccess`
- `studioAccessRepository`
- `StudioAccessRole`
- `MASTRA_GATEWAY_ADMIN_API`

## What To Build

1. Add a bearer-authenticated gateway API for Admin to look up, approve, and revoke Studio access by email.
2. Add an Admin-side outbound client that calls that API only when gateway URL/key env is configured.
3. Show persisted Mastra Studio access state in `/dashboard/users`.
4. Enable the Mastra Studio dropdown to grant Studio access as gateway `editor` and revoke it back to no access.

## Constraints

- Do not store Mastra Studio grants in the Admin database.
- Do not make Admin roles imply Mastra Studio access.
- Do not expose gateway `admin` grants from the Admin Users table in this slice.
- Do not reuse broad workflow, ingest, Manager, or web bearer keys for the gateway access API.
- Keep the UI local to the Users table and keep Mastra gateway as the source of truth.

## Verification

- `pnpm --filter @forge/admin test -- src/app/dashboard/ops-data.test.ts src/app/dashboard/dashboard-ui.test.tsx src/services/mastra-studio-access.service.test.ts`
- `pnpm --filter @forge/mastra-gateway test -- src/services/studio-access.service.test.ts src/app/api/admin/studio-access/route.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/mastra-gateway typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm --filter @forge/mastra-gateway lint`
- `git diff --check`
