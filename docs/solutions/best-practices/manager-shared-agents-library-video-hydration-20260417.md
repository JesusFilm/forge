---
title: "Hydrate Shared Manager Agents from Library Videos"
date: 2026-04-17
category: best-practices
module: manager
problem_type: best_practice
component: ai
severity: medium
applies_when:
  - "Manager shared agents should operate on canonical library videos instead of pasted text"
  - "An operator needs translation, SEO, or marketing drafts grounded in a real video"
  - "The shared agent package must stay app-agnostic while Manager adds library-aware UX"
tags:
  - manager
  - agents
  - video-library
  - hydration
  - mastra
---

# Hydrate Shared Manager Agents from Library Videos

## Context

The first shared-agent slice gave Manager a reusable Mastra-backed workbench, but it still depended on manually pasted text. That made library workflows awkward: operators wanted to translate video metadata or improve a video's SEO directly from the actual video record already in the CMS.

## Guidance

### Keep the shared agent catalog generic

Do not move library lookup logic into `packages/agents`. The shared package should keep defining reusable agent metadata, validation, and prompt posture only.

### Add library awareness in Manager

Put video search and hydration logic in `apps/manager`:

- search videos by title or slug
- load canonical metadata for one selected video
- fetch trusted subtitle text when it is useful for the current agent
- return a hydrated draft in the same generic run-request shape the agent workbench already uses

This preserves the generic execution contract while giving Manager a first-class library workflow.

### Hydrate drafts, do not fork the run route

Prefer a two-step flow:

1. search/select a library video
2. hydrate the current agent draft from that video

Then keep using the same generic `/api/agents/:id/run` route.

This avoids route sprawl and keeps the operator free to edit the hydrated draft before running it.

### Use transcript context selectively

Translation of metadata usually needs only title and description. SEO and packaging agents benefit from more context, so subtitle transcript excerpts can be included when a trusted subtitle source exists.

Recommended default:

- Translation: metadata only
- SEO: metadata + transcript excerpt when available
- Video Enhancing: metadata + transcript excerpt when available
- Marketing: metadata + transcript excerpt when available

### Trust only approved subtitle sources

Use the existing trusted subtitle fetch path. If subtitle context is unavailable or untrusted, hydrate the draft from canonical metadata only and surface that status in the UI instead of failing the entire interaction.

## Why This Matters

- Operators can work from real library videos instead of retyping source material.
- Shared agents remain reusable across apps because Manager-specific library logic stays local.
- The generic shared-agent contract stays stable.
- Subtitle fetch failures degrade gracefully into metadata-only hydration instead of breaking the workbench.

## Examples

- Video search + hydration helpers: `apps/manager/src/features/agents/shared-agent-video-library.ts`
- Video search route: `apps/manager/src/app/api/agents/videos/route.ts`
- Video hydration route: `apps/manager/src/app/api/agents/videos/[id]/hydrate/route.ts`
- Workbench integration: `apps/manager/src/features/agents/shared-agent-workbench.tsx`

## Related

- `docs/roadmap/media-generation/feat-097-manager-shared-mastra-agents.md`
- `docs/roadmap/media-generation/feat-098-manager-library-video-aware-shared-agents.md`
