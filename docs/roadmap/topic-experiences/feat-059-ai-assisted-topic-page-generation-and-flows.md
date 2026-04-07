---
id: "feat-059"
title: "AI-Assisted Topic Page Generation and Flows"
owner: "tataihono"
priority: "P1"
status: "not-started"
start_date: "2026-08-01"
duration: 45
depends_on:
  - "feat-013"
  - "feat-016"
  - "feat-021"
blocks:
  - "feat-069"
tags:
  - "cms"
  - "web"
  - "topic-pages"
---

## Problem

The initial topic-generation work produces topic pages, but the product still needs a cohesive flow for drafting, reviewing, validating, and publishing AI-assisted topic experiences. This ticket turns the generation pipeline into an editor-friendly operating model instead of a one-time batch output.

## Entry Points — Read These First

1. `docs/roadmap/topic-experiences/feat-013-bulk-experience-generation.md` — generation baseline
2. `docs/roadmap/topic-experiences/feat-016-topic-experience-graphql.md` — delivery contract for consumers
3. `docs/roadmap/topic-experiences/feat-021-generation-quality-monitoring.md` — quality dashboard baseline
4. `apps/cms/src/api/experience/content-types/experience/schema.json` — experience model
5. `apps/web/src/lib/content.ts` — web-side topic and experience query surface

## Grep These

- `topic` in `docs/roadmap/topic-experiences/`
- `experience` in `apps/cms/src/api/experience/`
- `graphql(` in `apps/web/src/lib/content.ts`
- `quality` in `docs/roadmap/topic-experiences/`

## What To Build

1. Define the full lifecycle for AI-assisted topic pages: draft, review, approve, publish, and iterate.
2. Connect generation outputs, monitoring signals, and front-end consumption into one manageable flow.
3. Add the review checkpoints needed for theology, editorial quality, and user-experience quality.
4. Keep the flow compatible with both batch-generated and manually adjusted topic pages.

## Constraints

- Do NOT reduce topic generation to a one-click publish path with no review gates.
- Preserve a human-editable escape hatch for topic pages that need manual refinement.
- Avoid duplicating the same topic state in multiple systems.

## Verification

- A generated topic page can move from draft to published through an explicit workflow
- Editors can see the generation inputs and quality signals attached to a topic page
- Web consumers continue to read the published contract without special cases
