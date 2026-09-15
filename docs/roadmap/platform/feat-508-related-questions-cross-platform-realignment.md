---
id: "feat-508"
title: "Re-align mobile and TV Related Questions with web"
owner: "unassigned"
priority: "P2"
status: "not-started"
start_date: "2026-09-08"
duration: 3
depends_on: []
blocks: []
tags:
  - "platform"
  - "mobile"
  - "tv"
  - "web"
---

## Problem

One authored `relatedQuestions` block is rendered by three apps. Web moved its
presentation to hairline rows under a display heading when both Watch FAQ
surfaces were consolidated onto a shared component; mobile and TV still render
the previous tinted-card idiom they were deliberately built against.

The same authored FAQ therefore reads as two different designs depending on the
device. That divergence is a recorded decision, not a bug — this ticket exists
so the next mobile or TV design pass reads it that way and decides whether to
follow, rather than filing it as a regression.

## Entry Points - Read These First

1. `docs/plans/2026-08-31-2046-feat-shared-watch-faq-component-plan.md`
   - the consolidation that moved web's presentation.
2. `apps/web/src/components/watch/WatchFaqList.tsx`
   - web's current shared row: hairline dividers, `py-6`, `font-semibold`
     question at `text-lg`/`sm:text-xl`, rotating chevron.
3. `apps/mobile/src/components/sections/RelatedQuestionsRenderer.tsx`
   - mobile's card row, still on the previous reference.
4. `apps/tv/src/components/sections/RelatedQuestionsRenderer.tsx`
   - TV's card row, same.
5. `docs/plans/2026-03-26-003-feat-related-questions-leading-icon-plan.md`
   - records that mobile was built against web as the reference design.
6. `docs/roadmap/platform/feat-312-watch-faq-row-alignment.md`
   - the web row alignment the consolidation superseded.

## Grep These

- `RelatedQuestionsRenderer`
- `questionRow`
- `relatedQuestions`

## What To Build

1. Decide whether mobile and TV follow web's hairline presentation or keep the
   card idiom as a deliberate per-platform choice.
2. If following: port row rhythm, question weight and scale, and the divider
   treatment, keeping each platform's own disclosure primitive.
3. If not following: record the per-platform divergence in both renderers so the
   next reader does not treat it as drift.

## Constraints

- Do not change the authored content contract. `RelatedQuestionsBlockSchema` in
  `apps/admin/src/domain/blocks.ts` is shared by all three apps.
- Do not import web components into the React Native apps.
- Keep each platform's accessibility affordances; web's native
  `<details>`/`<summary>` has no React Native equivalent.

## Verification

- Both renderers reflect the decision, and a reader can tell from the code which
  way it went and why.
- Existing renderer tests pass on each app.
