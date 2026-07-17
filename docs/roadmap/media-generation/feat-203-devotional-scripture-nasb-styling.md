---
id: "feat-203"
title: "Devotional Scripture — NASB Text + Styled Card"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 6
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
  - "i18n"
---

## Problem

Scripture is currently proposed from model memory (`needsCanonicalSource: true`),
not authoritative NASB text, and the verse card looks like ordinary body text.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/scripture-selector.ts` — current selection.
2. `apps/mastra` CLAUDE.md — `API_BIBLE_API_KEY` / `SUBTITLE_VALIDATION_BIBLE_*` (existing API.Bible wiring).
3. `packages/shorts-compositions/src/devotional/DevotionalVideo.tsx` — scripture card.

## What To Build

Fetch exact NASB verse text via API.Bible (fall back to model knowledge only if
unavailable). Style the scripture card distinctly: left vertical accent rule,
serif/italic, larger leading — clearly different from hook/reflection text.

## Constraints

Confirm NASB (Lockman) licensing on API.Bible before shipping. Keep the path
multilingual-ready for future translations.

## Verification

Verse text matches NASB exactly; scripture card visually distinct (left rule).
