---
id: "feat-304"
title: "Watch homepage CTA contract"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-262"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "navigation"
  - "accessibility"
  - "analytics"
---

## Problem

The published Watch homepage contains a media-section CTA whose authored `/`
placeholder outranks a valid inferred collection and is normalized to `/watch`,
causing a homepage reload. Several other section CTAs use repeated visible
labels such as `Watch`, `See all`, and `Read more` without section-specific
accessible names or a stable destination-click analytics action.

Linear: FGE-21 (linked from WAT-255).

## Production Inventory

Captured from `/watch` on 2026-07-23:

1. `Begin Day One` →
   `/watch/7-days-with-jesus-walk-with-jesus.html/english.html`
2. `Watch the Gospels` → `/watch/lumo.html/english.html`
3. `Happiness — See all` → `/watch/shine-happy.html/english.html`
4. `Films About Jesus — See all` → `/watch` (defect)
5. `El Camino — See all` →
   `/watch/the-way-of-st-james.html/english.html`
6. `Acts — Watch` →
   `/watch/lumo-acts-of-the-apostles.html/english.html`
7. `Bible on Film — Watch` → `/watch/languages`
8. `Begin the Course` →
   `/watch/new-believer-course.html/english.html`
9. `NUA — Watch` →
   `/watch/nua-fresh-perspective.html/english.html`
10. `Every Gospel — Watch` → `/watch/languages`
11. `Watch the Full Story` →
    `/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html`
12. `FAQ — Read more` → `https://www.jesusfilm.org/about/faq/`

The separate footer Watch navigation link intentionally remains `/watch` and is
outside this content-section contract.

## Entry Points - Read These First

1. `docs/plans/2026-07-23-002-fix-watch-homepage-cta-contract-plan.md`
2. `apps/web/src/components/sections/MediaCollection.tsx`
3. `apps/web/src/components/sections/RelatedQuestions.tsx`
4. `apps/web/src/components/home/WatchHomeExperiencePage.tsx`
5. `apps/web/src/lib/routes.ts`
6. `apps/web/src/components/DatadogRum.tsx`

## Grep These

- `mediaCtaLink`
- `mediaDefaultCollectionSlug`
- `ExperienceSectionRenderer`
- `data-watch-home-section-cta`
- `WATCH_HOME_SECTION_CTA_ACTION`

## What To Build

1. Reject homepage-equivalent, deprecated-search, malformed, and unsupported
   Watch-local destinations only for Watch-home content CTAs.
2. For media sections, fall through to the existing localized inferred
   collection or `/watch/languages` behavior.
3. Preserve canonical Watch routes, ministry-site links, and external HTTP(S)
   destinations.
4. Give every currently published media and Related Questions CTA a
   visible-label-plus-section accessible name.
5. Emit one bounded `watch_home.section_cta_clicked` analytics action with the
   resolved destination.
6. Keep footer/global navigation and route/canonical infrastructure unchanged.

## Constraints

- Use existing route builders, public language slugs, and canonical segment
  grammar.
- Do not globally change `/` normalization for other Experience surfaces.
- Do not mutate published Experience JSON or bypass production authorization.
- Do not add render-time destination fetches, route-manifest work, or a
  page-level client boundary.
- Do not silently extend this contract to CTASection, PromoBanner, hero, card,
  or item-level actions that are absent from the captured production inventory.

## Verification

- `pnpm --filter @forge/web exec vitest run src/lib/watch-home-cta.test.ts src/components/sections/MediaCollection.test.tsx src/components/sections/RelatedQuestions.test.tsx src/components/sections/Section.test.tsx src/components/home/WatchHomeExperiencePage.test.tsx src/components/home/WatchHomeCtaInventory.test.tsx src/components/home/WatchHomeFooter.test.tsx`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter roadmap generate:readme`
- `git diff --check`
- Run desktop and mobile browser proof for href, accessible name, direct 200
  navigation, matching canonical, and page-load network behavior.

## Completion Notes

- The Watch-home surface now rejects homepage-equivalent and malformed authored
  media/FAQ destinations without changing other Experience surfaces. The
  existing media fallback resolves the published Films About Jesus CTA to
  `/watch/jfm-collection.html/english.html`.
- All 12 current content CTAs render a visible-label-plus-section accessible
  name and emit a bounded best-effort destination action. The global footer
  Watch link remains outside the contract.
- Focused Web validation passed: 7 Vitest suites / 99 tests, Web typecheck,
  touched-file ESLint and Prettier, generated roadmap index, and
  `git diff --check`.
- Desktop and 375 px mobile browser smoke rendered all 12 scoped CTAs, preserved
  the footer boundary, and followed the repaired CTA to a direct 200 JFM
  Collection page. Its local path matches the canonical
  `https://www.jesusfilm.org/watch/jfm-collection.html/english.html`.
- The captured homepage load contained no CTA-specific request. Three existing
  Watch API requests remained (`watch-progress`, `beta-tester-cta`, and
  `auth/session`); this change adds no fetch, effect, or page-level client
  boundary.
