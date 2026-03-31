---
id: "feat-024"
title: "Mobile App — Expo"
owner: "ekkasit"
priority: "P0"
status: "complete"
start_date: "2026-03-02"
duration: 28
depends_on:
  - "feat-022"
  - "feat-026"
blocks:
  - "feat-029"
tags:
  - "mobile"
---

## Problem

The platform needed a cross-platform mobile app to render CMS experiences on phones. Expo (React Native managed workflow) was chosen for its developer experience, OTA updates, and shared JavaScript ecosystem with the web app.

## Entry Points — Read These First

1. `apps/mobile/` — the Expo app root
2. `apps/mobile/src/components/sections/` — section renderer components for all CMS types
3. `apps/mobile/src/lib/graphql/` — GraphQL client and queries
4. `apps/mobile/src/app/` — Expo Router screens (watch home, experience-by-slug)
5. `apps/mobile/src/hooks/useTypography.ts` — responsive typography system

## Grep These

- `SectionDispatcher\|SectionRenderer` in `apps/mobile/src/` — section dispatch
- `graphql(` in `apps/mobile/src/` — typed query definitions
- `useTypography` in `apps/mobile/src/` — responsive typography hook usage
- `WebView` in `apps/mobile/src/` — QuizButton WebView modal

## What Was Built

1. Scaffolded Expo managed-workflow app with Expo Router navigation.
2. Built GraphQL client and codegen integration for typed CMS queries.
3. Implemented section renderers for all 12 CMS section types: TextRenderer, VideoRenderer, VideoHeroRenderer, CTARenderer, CardRenderer, BibleQuotesCarouselRenderer, RelatedQuestionsRenderer, MediaCollectionRenderer, SectionWrapperRenderer, ContainerRenderer, EasterDates, QuizButton (with WebView modal).
4. Added hero video autoplay with mute toggle, responsive typography system, styled video collection carousel with overlay cards, navigation carousel with scroll-to-section.
5. CI pipeline for lint, typecheck, and build.

## Verification

- `ls apps/mobile/src/components/sections/` — 12+ section renderer files present
- `cd apps/mobile && pnpm lint` — linting passes
- App renders the Easter experience with all section types
