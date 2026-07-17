---
id: "feat-207"
title: "Devotional Reflection — Cru Source + Varied Layouts"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 8
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

Reflection is generated generically and every card looks the same, which gets
monotonous.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/partner-devotional.ts` — Cru fetch + adapt.
2. `apps/mastra/src/services/devotional/video-segments.ts` — card/segment build.
3. `devo/partner-devotional-sources.md` — Cru source URLs.

## What To Build

Source reflections from Cru devotionals (adapt in our own voice, never verbatim).
Vary card layouts: card 1 up to 3 paragraphs; later cards 1 short paragraph,
centered, larger font, with a highlighted phrase; rotate layout per card.
Left-aligned by default for readability.

## Constraints

Confirm Cru reuse terms. Output stays derivative (our voice), not a copy.

## Verification

Consecutive reflection cards use visibly different layouts; text reads as ours.
