---
id: "feat-170"
title: "YouTube video mapper backend scaffold"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-06-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "content-discovery"
  - "video"
  - "analytics"
  - "backend"
  - "matching"
---

## Problem

Analytics needs a backend surface for mapping externally re-uploaded video files
back to canonical Core `coreId` and `videoVariantId` values. In Forge/Admin
terms, those are `Video.coreId` and `VideoDub.coreId`. The product shape is
still early, but the repo needs a correctly located workspace app and a durable
requirements/handoff trail before implementation planning continues.

## Entry Points - Read These First

1. `apps/yt-video-mapper-backend/README.md` - app purpose and package commands.
2. `apps/yt-video-mapper-backend/docs/brainstorms/video-source-mapper-requirements.md`
   - current product requirements and open questions.
3. `apps/yt-video-mapper-backend/docs/handoffs/forge-agent-prompt.md` -
   condensed handoff prompt for future implementation work.
4. `apps/yt-video-mapper-backend/src/server.ts` - initial health endpoint and
   explicit placeholder match endpoint.
5. `apps/AGENTS.md` - workspace app boundaries.

## Grep These

```bash
rg -n "yt-video-mapper|video mapper|VideoDub|VideoSubtitle|/match" apps/yt-video-mapper-backend docs/roadmap/content-discovery
rg -n "VideoDub|VideoSubtitle|scene embedding|transcript" apps/admin/src apps/mastra/src
```

## What To Build

1. Create `apps/yt-video-mapper-backend` as a Forge pnpm workspace package named
   `@forge/yt-video-mapper-backend`.
2. Preserve the brainstorm requirements and Forge handoff notes inside the app
   so future planning can start from the current product decisions.
3. Add a minimal Node backend skeleton with:
   - `GET /health` returning service status.
   - `POST /match` returning an explicit `501 not_implemented` placeholder.
4. Add package-level TypeScript, ESLint, Vitest, and build configuration.
5. Keep the app independent from Admin, Mastra, and consumer apps until the
   implementation plan chooses the catalog and matching integration points.

## Constraints

- Do not create a standalone git repo outside Forge.
- Do not commit generated `dist/` or `node_modules/` output.
- Do not hardcode the Jesus Film GraphQL gateway URL; use environment variables
  if a future implementation needs the gateway.
- Do not treat external YouTube metadata as proof of a match.
- Do not implement the real matching pipeline in this scaffold slice.

## Verification

```bash
pnpm --filter @forge/yt-video-mapper-backend lint
pnpm --filter @forge/yt-video-mapper-backend test
pnpm --filter @forge/yt-video-mapper-backend typecheck
pnpm --filter @forge/yt-video-mapper-backend build
```
