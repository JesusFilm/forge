---
id: "feat-302"
title: "Add truthful structured data to Watch landing pages"
owner: "unassigned"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "seo"
  - "structured-data"
---

## Problem

The canonical Watch home and localized-home routes emit no page-owned JSON-LD.
Series landings also lack a Forge-owned collection entity. Playable routes emit
video markup, but it currently presents the landing URL as an embed player,
uses generic artwork and slug-like language fallbacks, rounds durations, and
adds schema-only breadcrumbs.

This resolves Linear FGE-8 without changing public routes or contextual Watch
navigation.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-structured-data.ts` - JSON-LD builders and escaping.
2. `apps/web/src/lib/experience-metadata.ts` - canonical playable metadata.
3. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` - root Watch homepage.
4. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - localized home,
   series, standalone-video, and contextual-episode route owner.
5. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - visible home
   hero and authored-block renderer.

## Grep These

- `watchVideoStructuredDataJson`
- `WatchHomeExperiencePage`
- `MediaCollectionBlock`
- `SeriesPageClient`
- `publishedAt`
- `SeekToAction`

## What To Build

1. Emit a server-rendered `CollectionPage` with a bounded, truthful `ItemList`
   on root, localized-home, and eligible series routes.
2. Build homepage list entries from the exact initial hero sequence and
   authored media blocks that render on the page, never legacy hidden sections.
3. Emit one complete primary `VideoObject` only for indexable playable pages
   with page-specific copy, video artwork, Core publication date, a public media
   URL, BCP-47 language, precise duration, publisher, and eligible captions.
4. Add `SeekToAction` only where the public `?t=` contract is proven; remove
   false `embedUrl` and schema-only breadcrumbs.
5. Bound and deduplicate related and series lists, keeping contextual UI
   navigation unchanged while structured entities use canonical standalone
   video URLs.
6. Prove initial-response HTML, route contracts, media access, timestamp edge
   cases, and performance boundaries.

## Constraints

- Do not invent `Clip`, FAQ, or breadcrumb content.
- Do not use generic social artwork or language slugs as structured-data
  fallbacks.
- Do not add a second data request, client-side JSON-LD injection, or route
  dynamism.
- Do not change Watch public URL shapes, contextual navigation, canonical
  policy, or sitemap-owned hreflang.
- Keep every list bounded at 12 entries.

## Verification

- `pnpm --filter @forge/web test -- src/lib/watch-structured-data.test.ts`
- `pnpm --filter @forge/web test -- src/lib/experience-metadata.test.ts`
- `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/page.test.tsx`
- `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- `pnpm --filter @forge/web test -- src/components/watch/__tests__/HeroPlayer.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web build`
- Production-mode raw-response probe plus browser smoke for root, localized
  home, series, standalone feature/segment, and contextual episode routes.

## Resolution

Completed 2026-07-23 for Linear FGE-8.

- Root, localized-home, and eligible series routes now emit one
  server-rendered `CollectionPage` with a bounded, deduplicated `ItemList`
  projected from the links the page actually renders.
- Eligible standalone and contextual playable routes now emit one truthful
  `VideoObject` with canonical standalone identity, public media and caption
  URLs, precise duration, Core publication date, publisher, and a browser-
  proven `SeekToAction`. False `embedUrl`, schema-only breadcrumbs, FAQ, and
  invented Clip entities are absent.
- `noIndex` and incomplete entities fail closed. Series schema also fails
  closed when the route manifest is unavailable instead of advertising
  unproven destinations.
- Browser verification found and fixed a deferred-player race that reset
  `?t=` deep links to zero when the user pressed **Watch now**. The focused
  regression test and a real `?t=12` playback smoke now cover that path.
- Final validation: 275 focused tests passed with 2 pre-existing todos,
  typecheck, lint, production build, production-mode initial-response parsing,
  and browser smoke. Detailed evidence and known harness limitations are in
  `docs/qa/watch-structured-data-2026-07-23.md`.
