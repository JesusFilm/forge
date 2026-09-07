---
id: "feat-461"
title: "Studio planning calendar and scheduled publication"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-09-07"
duration: 3
depends_on:
  - "feat-455"
  - "feat-457"
  - "feat-460"
blocks:
  - "feat-462"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Lyuba needs a lightweight publishing plan that can prepare titles/themes without wasting generation on material she may replace.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/manager/src/features/video-studio/ (proposed)`
3. `apps/admin/src/services/studio-authoring/ (proposed)`
4. `apps/mastra/src/mastra/agents/studio-authoring/ (proposed)`
5. `docs/brainstorms/2026-09-07-studio-video-authoring-brief.md`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `StudioPlanSlot|idempotencyKey|expectedRevision|publishAt|timeZone`

## What To Build

1. Add calendar slots for the next fortnight and advance planning for the following fortnight, with optional project links and Content Pack assignment.
2. Run bounded idempotent planning once/twice daily to fill missing titles/themes from assigned/default packs; preserve manual overrides and edited projects.
3. Allow explicit single/batch generation through UI or agents, separate from planning automation and tied to the same review workflow.
4. Configure timezone and publish time explicitly; scheduled publication invokes the same approved-revision command as manual publication.
5. Leave missing, failed or unapproved slots unpublished with actionable state. Do not auto-substitute or force release.

## Constraints

- Planner tools cannot call script generation, TTS, render or publish.
- Projects do not require calendar slots.
- No automatic title/theme plan may replace existing edited or approved work without inclusion by the operator.

## Verification

- Test duplicate planner runs, empty/default packs, manual overrides, timezone/DST transitions and scheduling races.
- Assert no script/provider-media generation occurs during planning.
- Browser smoke for standalone project scheduling, explicit generation and an unready slot remaining unpublished.
