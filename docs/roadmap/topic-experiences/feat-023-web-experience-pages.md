---
id: "feat-023"
title: "Web Experience Pages"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-02-17"
duration: 31
depends_on:
  - "feat-022"
  - "feat-026"
blocks:
  - "feat-029"
  - "feat-289"
  - "feat-312"
tags:
  - "web"
---

## Problem

The web app needed to render CMS-driven experience pages with all section types. Each experience (like Easter) is a dynamic page composed of section blocks — VideoHero, Text, Carousel, etc. — fetched via GraphQL and rendered with Next.js App Router and Server Components.

## Entry Points — Read These First

1. `apps/web/src/app/[slug]/[locale]/page.tsx` — dynamic Experience page route
2. `apps/web/src/app/page.tsx` — home page
3. `apps/web/src/lib/content.ts` — all GraphQL operations (queries, fragments)
4. `apps/web/src/components/sections/` — section renderer components (one per CMS section type)
5. `apps/web/src/app/api/revalidate/route.ts` — ISR webhook endpoint for on-demand revalidation

## Grep These

- `SectionRenderer\|renderSection\|switch.*__typename` in `apps/web/src/` — section dispatch logic
- `graphql(` in `apps/web/src/lib/content.ts` — typed GraphQL query definitions
- `revalidatePath\|revalidateTag` in `apps/web/src/` — ISR revalidation
- `'use client'` in `apps/web/src/components/` — client-side components

## What Was Built

1. Dynamic experience page route at `/[slug]/[locale]` with GraphQL data fetching.
2. Section renderer components for all 12 CMS section types: VideoHero, Text, Container, Card, CTA, BibleQuotesCarousel, RelatedQuestions, Video, MediaCollection, NavigationCarousel, EasterDates, QuizButton.
3. ISR (Incremental Static Regeneration) with Strapi webhook-based on-demand revalidation.
4. Video carousel picker and navigation carousel section components.
5. Colocated section fragments with their components for maintainability.
6. Tailwind CSS styling throughout.

## Verification

- `cd apps/web && pnpm build` — builds without errors
- `ls apps/web/src/components/sections/` — 12+ section renderer files present
- `/watch/easter` route renders the Easter experience with all section types
