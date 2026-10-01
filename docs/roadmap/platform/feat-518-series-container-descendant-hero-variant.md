---
id: "feat-518"
title: "Series container heroes derive a playable variant from a descendant episode"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-09-16"
duration: 1
depends_on: []
blocks: []
tags: [web, watch, series, i18n, hero]
---

## Problem

Reported as "Rivka is unplayable in Mandarin: no segments available to play".
The defect is neither Rivka-specific nor Mandarin-specific.

`tryResolveWatchRouteBySlug` derived a series' `selectedVariant` from
`playableVariantsForRecord(record)` — the container's OWN dubs. A container
owns none by construction: `mergeWatchVideoShellWithCopy` builds `variants`
from the singular `preferredVariant`, which Admin resolves against the
container's own dub rows. So the series branch returned `selectedVariant: null`
for every series in every language, and `SeriesHero` fell through to
`SeriesHeroStatic` — a poster with nothing to play.

English was equally broken the whole time. It degrades silently rather than
erroring, so only the Mandarin audience reported it.

Not implicated: `fetchVideoChildDubLanguages` and the page's `seriesLanguage`
`notFound()` gate. Admin's `getChildDubLanguages` correctly returns Mandarin
for Rivka. Episode (3-segment) routes were never affected.

## Entry Points — Read These First

1. `apps/web/src/lib/content.ts` — `selectDescendantPlayableVariant`,
   `SERIES_DESCENDANT_VARIANT_PROBE_LIMIT`, and the series branch of
   `tryResolveWatchRouteBySlug`.
2. `apps/web/src/components/watch/SeriesHero.tsx` — `hasPlayableTrailer`
   gates on `Boolean(variant.hls)`; false renders the static poster.
3. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — the series
   branch re-checks `selectedVariant.language.slug === seriesLanguage.slug`.
4. `apps/web/src/lib/__tests__/fixtures/rivka-series-container.ts` — the
   shared container/episode fixtures both suites drive.

## Grep These

- `selectDescendantPlayableVariant`
- `SERIES_DESCENDANT_VARIANT_PROBE_LIMIT`
- `variantMatchesRequestedLanguage`
- `hasPlayableTrailer`

## What Was Built

When a container has no playable variant of its own, probe up to three
non-container children via the existing React-cached `fetchWatchVideoBySlug`
and borrow the child's dub — but only when it is genuinely dubbed in the
requested language. Admin's `preferredPlayableDub` falls back to the child's
primary dub, so an unchecked fall-through would hand a Mandarin URL an English
stream. When nothing matches, the static hero stays, which is the honest state.

## Constraints

- Do NOT project child `dubs` onto the container snapshot. That is the ~45 MB /
  137k-row payload that breaks Next's 2 MB `unstable_cache` ceiling and is the
  reason the container carries no descendant variant data in the first place.
- Do NOT raise `SERIES_DESCENDANT_VARIANT_PROBE_LIMIT`. Each probe is a
  sequential Admin round-trip on the cache-miss path and lands on TTFB.

## Verification

```bash
cd apps/web
./node_modules/.bin/vitest run \
  src/lib/__tests__/series-descendant-variant.test.ts \
  "src/app/[locale]/[htmlLang]/[...rest]/__tests__/series-container-hero.test.tsx"
```

12 tests. Reverting the `selectDescendantPlayableVariant` fall-through reddens
10 of them; the two that stay green are the wrong-language negatives, which are
correctly language-independent.

## Known Limits — Follow-up Work

1. **Coverage beyond probe three.** A series whose only dub in the requested
   language starts at episode four keeps the static hero. Pinned by
   `probes at most SERIES_DESCENDANT_VARIANT_PROBE_LIMIT episodes`. A real fix
   needs a container-level language projection from Admin, not a bigger number.
2. **Hero metadata is the episode's.** `HeroPlayer` reads `variant.duration`
   and `variant.downloads`, so the series hero now shows episode 1's runtime
   and download-quality label under the series title. Needs a product decision:
   label the hero as the episode, or project container-level metadata.
3. **No page-load performance measurement.** Request-count evidence is pinned
   in the resolver suite (2 round-trips on the happy path, 4 worst case,
   sequential). No TTFB/Web Vitals measurement against a live environment.
