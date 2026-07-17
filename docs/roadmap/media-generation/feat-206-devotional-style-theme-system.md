---
id: "feat-206"
title: "Devotional Style / Theme System (video look → whole devo)"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 12
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

Video treatment and card styling are disconnected. We want the video look (B&W,
sepia, grain, cinematic) to define the ENTIRE devotional's style.

## Entry Points — Read These First

1. `apps/shorts-compositions/src/devotional/` — composition + schema.
2. `docs/plans/2026-06-24-001-feat-devotional-video-studio-plan.md` — "Style is a layer".

## What To Build

A `style` preset (start with ~3: `warm-cinematic`, `sepia-film`, `noir-bw`) that
sets video color grade + grain/filters AND propagates to card palette, fonts,
and music mood. Likely its own art-direction workflow/bot that picks the look and
emits the styled clip + the style object the assembler consumes.

## Constraints

Fixed preset set, not free-form — coherence across video, cards, and music. One
style per devo.

## Verification

Applying `noir-bw` renders the video AND all cards (and music choice) in that
style consistently.
