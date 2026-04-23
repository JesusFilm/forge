---
title: "feat: Manager Library Video-Aware Shared Agents"
type: feat
status: complete
date: 2026-04-17
roadmap:
  - /docs/roadmap/media-generation/feat-098-manager-library-video-aware-shared-agents.md
related:
  - /docs/roadmap/media-generation/feat-097-manager-shared-mastra-agents.md
branch: feat/manager-library-video-aware-shared-agents
---

# feat: Manager Library Video-Aware Shared Agents

## Overview

Extend the Manager shared-agent workbench so operators can search the video library, select a real video, and hydrate Translation, Video Enhancing, SEO, and Marketing agents with canonical video metadata and trusted subtitle context.

## Decisions

1. Keep `packages/agents` generic and Manager-agnostic.
2. Put library search and video hydration logic in `apps/manager`.
3. Hydrate the existing shared-agent draft shape instead of changing the generic run route contract.
4. Use subtitle transcript context opportunistically and only from trusted sources.

## Implementation Units

### Unit 1: Manager video search + hydration helpers

- `apps/manager/src/features/agents/shared-agent-video-library.ts`
- focused helper tests

### Unit 2: Authenticated Manager API routes

- `apps/manager/src/app/api/agents/videos/route.ts`
- `apps/manager/src/app/api/agents/videos/route.test.ts`
- `apps/manager/src/app/api/agents/videos/[id]/hydrate/route.ts`
- `apps/manager/src/app/api/agents/videos/[id]/hydrate/route.test.ts`

### Unit 3: Shared-agent workbench UX

- `apps/manager/src/features/agents/shared-agent-contract.ts`
- `apps/manager/src/features/agents/shared-agent-workbench.tsx`
- `apps/manager/src/app/globals.css`

## Verification

- `pnpm --filter @forge/manager test`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/manager lint`
- `git diff --check`
