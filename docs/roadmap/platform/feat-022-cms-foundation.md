---
id: "feat-022"
title: "CMS Foundation (Strapi v5 Content Modeling)"
owner: "tataihono"
priority: "P0"
status: "complete"
start_date: "2026-02-17"
duration: 24
depends_on: []
blocks:
  - "feat-023"
  - "feat-024"
  - "feat-025"
  - "feat-029"
tags:
  - "cms"
---

## Problem

The platform needed a headless CMS to manage structured content for experiences. Strapi v5 was chosen for its GraphQL plugin, admin UI, and flexible content modeling. Without this foundation, no front-end app could render dynamic experiences.

## Entry Points — Read These First

1. `apps/cms/src/api/experience/content-types/experience/schema.json` — Experience content type, the core entity
2. `apps/cms/src/components/` — all section component schemas (VideoHero, Text, Card, CTA, BibleQuotesCarousel, RelatedQuestions, Video, MediaCollection, Container, Section, EasterDates, QuizButton)
3. `apps/cms/config/database.ts` — PostgreSQL configuration
4. `apps/cms/config/plugins.ts` — GraphQL plugin and other plugin configuration
5. `apps/cms/schema.graphql` — generated GraphQL schema, the system contract

## Grep These

- `"kind": "collectionType"` in `apps/cms/src/api/` — all content types
- `"kind": "singleType"` in `apps/cms/src/api/` — single-type content
- `schema.json` in `apps/cms/src/components/` — all component schemas
- `dynamiczone` in `apps/cms/src/` — dynamic zone usage for section composition

## What Was Built

1. Bootstrapped Strapi v5 with PostgreSQL, GraphQL plugin, and admin UI.
2. Created the Experience content type with title, metaDescription, slug, and a dynamic zone for section blocks.
3. Built 12 section component schemas: VideoHero, Text, Card, CTA, BibleQuotesCarousel, RelatedQuestions, Video, MediaCollection (with NavigationCarousel variant), Container, Section, EasterDates, and QuizButton.
4. Established component composition patterns using dynamic zones and nested children.
5. Added widthPercent to section components for layout control.

## Verification

- `ls apps/cms/src/api/experience/` — Experience content type exists
- `ls apps/cms/src/components/` — 12+ component schemas present
- `cd apps/cms && pnpm build` — CMS builds without errors
