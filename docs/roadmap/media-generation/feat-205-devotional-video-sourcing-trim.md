---
id: "feat-205"
title: "Devotional Video Sourcing + Trim"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 10
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

The devo needs the right JESUS-film moment as a video card — found, pulled,
trimmed to the relevant scene, with clean fades.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/local-video-matcher.ts` + `jesus-film-catalog.ts`.
2. `apps/shorts-worker/scripts/detect-and-trim-snippet.mjs` — transcript-based trim.
3. `apps/shorts-worker/scripts/render-devotional-video.mjs` — `--video-card`.

## What To Build

Match the JF chapter (prod: admin/Mux search; local: 61-chapter catalog); pull
the real clip (prod from Mux, local upload); detect the moment by transcript +
timecode; trim with a small pad; fade in/out on the video card to separate it.

## Constraints

Trim window must land on the VISUAL moment, not just the narrated line (~20s
offset). Keep the clip's own audio on the video card.

## Verification

Detector prints matched transcript + timecodes; rendered card shows the intended
scene with fades.
