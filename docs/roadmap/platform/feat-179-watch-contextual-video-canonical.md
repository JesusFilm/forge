---
id: "feat-179"
title: "Watch contextual video canonical routing"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-06-11"
duration: 1
depends_on:
  - "feat-153"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
---

## Problem

Watch chapter videos can belong to multiple collections. The standalone video
URL must stay the single canonical SEO identity, while collection-context URLs
must preserve the collection carousel, clip index, current-state highlighting,
and chapter progression.

Current carousel links emit standalone video URLs, so navigation can resolve a
chapter through the wrong/default parent and corrupt collection state.

## Entry Points - Read These First

1. `docs/plans/2026-06-11-003-fix-watch-contextual-video-canonical-plan.md` -
   implementation plan for this slice.
2. `apps/web/src/lib/routes.ts` - watch URL builders and parser.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - two-segment
   standalone and three-segment contextual route handling.
4. `apps/web/src/lib/experience-metadata.ts` - watch canonical, Open Graph,
   Twitter, JSON-LD, and hreflang URL ownership.
5. `apps/web/src/components/watch/SiblingCarousel.tsx` - chapter navigation
   links and active clip state.

## What To Build

1. Keep standalone video URLs canonical:
   `/watch/{video}.html/{language}.html`.
2. Keep the existing contextual route shape:
   `/watch/{collection}.html/{video}/{language}.html`.
3. Render contextual routes with the requested collection as the carousel
   parent.
4. Point SEO/social/share canonical URLs for contextual routes back to the
   standalone video URL.
5. Add regression coverage for the Pilate-style multi-collection chapter
   navigation failure.

## Constraints

- Do not change the public contextual URL shape to add `.html` to the video
  segment.
- Do not make any collection URL the canonical SEO identity of a video.
- Do not break existing standalone watch video URLs.

## Verification

- Focused tests cover route helpers, metadata canonical URLs, contextual
  carousel hrefs, language switching, and share canonical behavior.
- Targeted `@forge/web` tests pass.
- Helium smoke confirms standalone and contextual watch URLs render the
  expected state.

## Plan

Implementation plan:
`docs/plans/2026-06-11-003-fix-watch-contextual-video-canonical-plan.md`

## Completion Notes

Implemented contextual Watch video routing parity:

- Standalone video pages remain the canonical SEO/share identity.
- Contextual collection pages keep the existing
  `/{collection}.html/{video}/{language}.html` shape and preserve carousel
  navigation state.
- Contextual metadata, Open Graph URL, JSON-LD URL, and hreflang alternates
  point to the standalone video URL.
- Standalone two-segment video pages no longer borrow a default parent for
  carousel state.
- Focused tests, typecheck, and lint pass. Local browser smoke was blocked by
  missing Forge web env vars.
