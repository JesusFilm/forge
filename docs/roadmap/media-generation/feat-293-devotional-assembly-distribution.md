---
id: "feat-293"
title: "Devotional Assembly & Distribution (web full + social short)"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-01"
duration: 10
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "web"
---

## Problem

The pieces (hook, scripture, video, reflection, prayer, voice, music, style) must
assemble into a finished video, in two cuts for two destinations.

## Entry Points — Read These First

1. `apps/shorts-worker/scripts/render-devotional-video.mjs` — Remotion render.
2. `apps/mastra/src/scripts/build-devotional-video-manifest.ts` — per-card audio.
3. `packages/shorts-compositions/src/devotional/` — composition.

## Grep These

- `render-devotional-video|outro` in `apps/shorts-worker`.
- `build-devotional-video-manifest|audio` in `apps/mastra/src/services/devotional`.
- `publishDevotional|social` in `apps/mastra/src/services/devotional`.

## What To Build

Render with per-card audio sync + outro hold (built). Emit two cuts: a **full**
2–3 min version for the website, and a **social short** teaser that links back to
the site for the full experience.

## Constraints

Full = 2–3 min; social short trimmed to a teaser. Daily cron + publish are
deploy-side.

## Verification

One run produces both a website cut (2–3 min) and a social short; both play with
synced narration + music.
