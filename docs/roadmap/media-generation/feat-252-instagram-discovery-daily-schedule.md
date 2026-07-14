---
id: "feat-252"
title: "Instagram discovery daily schedule"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-14"
duration: 1
depends_on:
  - "feat-175"
  - "feat-240"
blocks: []
tags:
  - "mastra"
  - "instagram"
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

The Instagram AI/Christian discovery workflow can be run manually through
Studio or the service route, but production has no recurring trigger. Operators
need one durable daily schedule without adding a second scheduler in Railway or
Embers.

## What To Build

- [x] Declare one Mastra schedule on `instagram-ai-christian-discovery` for
      `00:00 UTC` every day.
- [x] Preserve the workflow's existing input defaults, manual Studio runs, and
      `POST /forge-instagram-discovery` behavior.
- [x] Document the cadence and the Studio pause/resume control.
- [x] Cover the schedule configuration, evented-engine promotion, and empty
      scheduled input defaults with a focused workflow test.

## Entry Points - Read These First

1. `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.ts` -
   workflow definition, input defaults, and review-queue submission.
2. `apps/mastra/src/mastra/workflows/instagram-ai-christian-discovery.test.ts` -
   focused workflow and route coverage.
3. `apps/mastra/src/mastra/index.ts` - workflow registration and the unchanged
   service route.
4. `apps/mastra/CLAUDE.md` - operator documentation.

## Grep These

- `instagram-ai-christian-discovery` - workflow id and registration.
- `wf_instagram-ai-christian-discovery` - derived persisted schedule id.
- `getScheduleConfigs` - declarative schedule test seam.
- `/forge-instagram-discovery` - manual service route.

## Constraints

- Use the installed Mastra declarative workflow schedule API; do not add a
  dependency upgrade or separate scheduler bootstrap.
- Configure exactly one schedule with cron `0 0 * * *` and timezone `UTC`.
- Do not override scheduled input; the existing schema defaults remain the
  source of truth.
- Do not add Railway cron/config changes, database mutations, Embers changes,
  or an immediate production run.
- Deploy only through the normal pull-request-to-main flow.

## Verification

- `pnpm --filter @forge/mastra test -- src/mastra/workflows/instagram-ai-christian-discovery.test.ts`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
- After deployment, confirm Studio reports
  `wf_instagram-ai-christian-discovery` as active with `nextFireAt` set to the
  next UTC midnight and Railway still has no platform cron.
- After the first UTC midnight, confirm exactly one trigger, a successful
  workflow run, and a successful or normally non-fatal website review-queue
  submission.
