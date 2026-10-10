---
id: "feat-134"
title: "Remove Strapi CMS Runtime"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-05-25"
duration: 1
depends_on:
  - "feat-104"
blocks: []
tags:
  - "platform"
  - "admin"
  - "cms"
  - "decommission"
---

## Problem

The public consumer data layer has moved to Admin GraphQL. Keeping the Strapi
workspace app and Strapi-generated `packages/graphql` client in the monorepo
keeps old dependency surfaces alive and routes future work toward removed
contracts.

## What Shipped

1. Removed `apps/cms` and `packages/graphql`.
2. Rewired web, mobile, TV, and remaining Manager compile surfaces away from
   `@forge/graphql`.
3. Removed Strapi package dependencies, lockfile entries, Turbo codegen tasks,
   and CI jobs for the retired client.
4. Updated active package guidance to point public consumers at
   `packages/admin-graphql`.

## Verification

- `pnpm run format:check`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web build` with `apps/web/.env.ci`
- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager build` with `apps/manager/.env.ci`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
