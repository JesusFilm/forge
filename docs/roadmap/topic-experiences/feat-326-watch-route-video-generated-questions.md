---
id: "feat-326"
title: "Route generated questions into the shared single-video Experience"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-01"
duration: 1
depends_on:
  - "feat-325"
blocks: []
tags:
  - "admin"
  - "web"
  - "watch-page"
  - "experience"
  - "ai-pipeline"
  - "i18n"
---

## Problem

The shared single-video Experience currently has one authored Related Questions
list, so every video page receives the same FAQ. Core study questions cannot
fill this role because they contain prompts without answers and already render
in the generated Watch body. Admin needs a published per-video Q&A read model,
and Related Questions needs an explicit route-video source with a safe authored
fallback.

## Entry Points — Read These First

1. `apps/admin/prisma/schema.prisma` - video, locale status, and Core-owned
   study-question models.
2. `apps/admin/src/services/video.service.ts` - optimized Watch snapshot locale
   buckets.
3. `apps/admin/src/graphql/types/video.ts` - consumer/editor visibility and
   Video GraphQL relations.
4. `apps/admin/src/domain/blocks.ts` - Related Questions block contract.
5. `apps/web/src/lib/content.ts` - video normalization and `RouteVideo` context.
6. `apps/web/src/components/sections/RelatedQuestions.tsx` - disclosure and CTA
   rendering.
7. `apps/admin/src/scripts/web-fixtures.json` - shared template and local videos.

## Grep These

- `VideoStudyQuestion`
- `studyQuestionsExact`
- `itemsSource`
- `routeVideoChildren`
- `RouteVideo`
- `RelatedQuestions`
- `defaultTemplateExperience`

## What To Build

1. Add a localized `VideoGeneratedQuestion` model with required video and
   grounding-study-question relations, question, answer, order, `LocaleStatus`,
   publication/soft-delete fields, and generation provenance.
2. Expose public published generated Q&A through Video GraphQL and the Watch
   snapshot's exact, broad, and English locale buckets. Editor reads may inspect
   non-deleted drafts.
3. Add `questionsSource: "manual" | "routeVideoGeneratedQuestions"` to Related
   Questions, with manual as the compatibility default.
4. Carry the selected generated Q&A in Web's existing `RouteVideo` context and
   make the shared FAQ choose the complete generated list when available.
5. Keep the block's authored Q&A as an atomic fallback; never merge generated
   and manual lists.
6. Seed two local videos with distinct published Q&A, one video with no Q&A,
   and configure the one shared template to use route-video sourcing.

## Constraints

- Do not generate Q&A during a public Watch request.
- Do not create an Experience for each video or mutate Core-owned study rows.
- Do not publish generated output without explicit review state.
- Do not replace the canonical player or built-in study-question section.
- Do not add a production generator, bulk backfill, or review UI in this scope.

## Verification

- Prisma validation, migration, Admin schema generation, and admin-graphql
  introspection generation pass without drift.
- Focused Admin tests cover locale buckets and public/editor visibility.
- Focused Web tests cover standalone/episode context, manual compatibility,
  route Q&A, and no-data fallback.
- Local fixtures reseed idempotently.
- Browser smoke proves two videos show distinct Q&A and a third shows fallback,
  with clean console/network and no page-load regression.

## Completion Evidence

- Admin: 263 test files passed (4,042 tests, 2 skipped, 1 todo); lint,
  typecheck, Prisma validation, schema generation, and GraphQL introspection
  generation passed.
- Web: 156 test files passed (2,489 tests, 1 todo); lint and typecheck passed.
- The migration was applied in an isolated schema; a valid grounded row
  succeeded, a cross-video grounding relation failed at the composite foreign
  key, and deleting the video removed both question layers.
- Desktop browser proof showed different published Q&A on Jesus Feature Film
  and Easter Explained, authored fallback on My Last Day, and closed disclosure
  state after route changes.
- Browser network inspection captured 61 page requests and no client request to
  Admin. Mobile proof at a 390px viewport reported equal 375px document and
  body widths after removing the container grid overflow.
