---
id: "feat-239"
title: "Watch Public Media URL Hotfix"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-08"
duration: 1
depends_on:
  - "feat-236"
blocks: []
tags:
  - "platform"
  - "admin"
  - "web"
  - "media"
---

## Problem

`https://watch.jesusfilm.org/watch` still renders stale Admin preview URLs in
the Next/React payload, including `http://0.0.0.0:8080/api/media-assets/...`.
The typed GraphQL block resolvers prefer stored URL fields over asset IDs, so
old editor preview URLs can leak even after the raw blocks resolver hydrates
public media URLs.

## Entry Points - Read These First

1. `apps/admin/AGENTS.md`
2. `apps/admin/CLAUDE.md`
3. `apps/admin/src/graphql/types/blocks.ts`
4. `apps/admin/src/services/media-asset.service.ts`
5. `apps/web/src/lib/watch-home.ts`

## What To Build

1. Resolve asset-backed typed block URL fields from the asset ID before any
   stored URL fallback.
2. Return public media delivery URLs for public, ready assets.
3. Suppress private Admin media URLs from public GraphQL responses.
4. Preserve external non-Admin URL fallbacks and Core video URL behavior.

## Verification

- `pnpm --filter @forge/admin test -- src/graphql/types/blocks.test.ts`
- `pnpm --filter @forge/admin test -- src/services/media-asset.service.test.ts`
- `pnpm --filter @forge/admin schema:print`
- `pnpm --filter @forge/admin-graphql generate`
