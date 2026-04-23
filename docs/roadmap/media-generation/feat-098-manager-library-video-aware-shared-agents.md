---
id: "feat-098"
title: "Manager Library Video-Aware Shared Agents"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-04-17"
duration: 7
depends_on:
  - "feat-097"
blocks:
  - "feat-099"
tags:
  - "manager"
  - "ai-pipeline"
  - "agents"
  - "video-library"
---

## Problem

The Manager shared-agent workbench can run Translation, Video Enhancing, SEO, and Marketing agents, but today it only works on manually pasted text. Operators cannot pick a real library video and hydrate the agent with that video's metadata or subtitle context, which makes common tasks like translating video metadata or improving a library video's SEO awkward and error-prone.

## Entry Points — Read These First

1. `apps/manager/src/features/agents/shared-agent-workbench.tsx` — current shared-agent workbench UI
2. `apps/manager/src/features/agents/shared-agent-runtime.ts` — current agent execution path
3. `apps/manager/src/features/jobs/review-player/load-job-review-context.ts` — existing pattern for loading video title, description, language, and subtitle tracks from CMS
4. `apps/manager/src/services/subtitles.ts` — trusted subtitle text fetch + normalization helper
5. `apps/manager/src/app/api/agents/route.ts` and `apps/manager/src/app/api/agents/[id]/run/route.ts` — current shared-agent API surface
6. `apps/manager/src/cms/client.ts` — GraphQL client boundary for Manager server reads
7. `docs/roadmap/media-generation/feat-097-manager-shared-mastra-agents.md` — starter shared-agent baseline

## Grep These

- `shared-agent|agents-page|automation` in `apps/manager/src/features/agents/`
- `video(documentId|videos(filters` in `apps/manager/src/`
- `fetchSubtitleText|resolveCmsLanguageCode` in `apps/manager/src/`

## What To Build

1. Add a Manager-only library video search/hydration layer for shared agents.
2. Let an operator search the library and select a real video from inside the shared-agent workbench.
3. Hydrate the selected agent with video-aware defaults using the chosen video's canonical metadata and, when available, trusted subtitle transcript context.
4. Keep agent execution generic; the video-aware step should prepare draft input rather than create bespoke execution routes per agent.
5. Support the practical first workflows:
   - translate video metadata into a target language
   - improve a library video's SEO using title, description, and transcript context
   - improve packaging/marketing for a library video with real source context

## Constraints

- Do not turn `packages/agents` into a Manager-specific video package.
- Keep library search/hydration inside `apps/manager`.
- Prefer trusted subtitle text sources only; do not fetch arbitrary URLs.
- Preserve the existing free-form shared-agent mode when no video is selected.
- Keep the current generic `/api/agents/:id/run` execution contract intact.

## Verification

- Manager operators can search and select a library video from the shared-agent workbench.
- Selecting a video hydrates the current agent with relevant metadata and subtitle context.
- Translation and SEO flows can run against a real selected library video without manual copy-paste of source metadata.
- Focused tests cover video search/hydration helpers plus the new Manager API routes.
- Focused checks pass:
  - `pnpm --filter @forge/manager test`
  - `pnpm --filter @forge/manager typecheck`
  - `pnpm --filter @forge/manager lint`
  - `git diff --check`
