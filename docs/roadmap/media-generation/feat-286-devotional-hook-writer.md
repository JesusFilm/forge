---
id: "feat-286"
title: "Devotional Hook Writer"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-07-01"
duration: 5
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

The opening hook decides whether anyone keeps watching, but it's written by the
generic devotional LLM. It needs a dedicated craft skill.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/hook-picker.ts` — news/holiday/question selection.
2. `docs/plans/2026-06-24-001-feat-devotional-video-studio-plan.md` — full context.

## Grep These

- `pickHook|holiday|news` in `apps/mastra/src/services/devotional/hook-picker.ts`.
- `hook` in `apps/mastra/src/services/devotional/devotional-writer.ts`.
- `MAX_HOOK|hook.*length` in `apps/mastra/src/services/devotional`.

## What To Build

A dedicated hook-writing prompt/persona: ≤~12 words, captivating, no cliché, a
curiosity gap even when sourced from news. Few-shot examples + a length/quality
gate. Priority order stays: news (Firecrawl) → holiday → intriguing question.

## Constraints

Not a new model — a tuned prompt + examples. Keep the existing priority cascade.

## Verification

Generated hooks are ≤~12 words and read as a hook, not a summary; manual review
of a sample across news/holiday/question sources.
