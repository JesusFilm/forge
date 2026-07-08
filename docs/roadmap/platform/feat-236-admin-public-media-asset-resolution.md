---
id: "feat-236"
title: "Admin Public Media Asset Resolution"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on:
  - "feat-107"
blocks: []
tags:
  - "platform"
  - "admin"
  - "media"
  - "web"
---

## Problem

Experience blocks can store Admin media asset IDs alongside preview URLs. The
preview URLs point at authenticated Admin routes, so public production clients
cannot load those images even though the asset ID is present.

## What To Build

1. Add an unauthenticated Admin media delivery route for public, ready assets.
2. Resolve block media asset IDs to public delivery URLs from the Admin GraphQL
   read path.
3. Keep private Admin editor preview routes unchanged.
4. Allow Web's Next image optimizer to load public Admin media delivery URLs.

## Verification

- `pnpm --filter @forge/admin test -- src/services/media-asset.service.test.ts`
- `pnpm --filter @forge/admin test -- src/app/api/public/media-assets/[id]/[variant]/route.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
