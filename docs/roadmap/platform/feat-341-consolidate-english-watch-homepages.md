---
id: "feat-341"
title: "Consolidate English Watch homepages"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-07"
completed_date: "2026-08-07"
duration: 1
depends_on:
  - "feat-302"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
  - "i18n"
---

## Problem

Watch treats every public English audio slug as a potential localized homepage.
Those pages reuse the international ministry homepage rather than publishing
materially different regional content, so separate self-canonical URLs split
crawler signals and turn Dub taxonomy into unsupported regional SEO targeting.

## Entry Points — Read These First

1. `apps/web/src/proxy.ts` — public alias redirects and internal locale rewrites.
2. `apps/web/src/lib/watch-sitemap.ts` — homepage sitemap entry and alternates.
3. `apps/web/src/lib/watch-language-switcher.ts` — global language destinations.
4. `apps/web/src/components/FloatingSearchProvider.tsx` — inner-route home links.
5. `apps/web/src/lib/locale.ts` — English audio slug and HTML language identity.
6. `docs/solutions/performance-issues/watch-hreflang-sitemap-manifest-20260612.md`
   — sitemap-only hreflang ownership.

## Grep These

- `english-british`
- `english-african`
- `english-north-american-indigenous`
- `isPublicWatchHomeLanguageSlug`
- `localizedHomePath`
- `languageSwitcherTarget`
- `createWatchHomeSitemapEntries`
- `x-default`

## What To Build

1. Permanently redirect every one-segment English audio homepage alias directly
   to `/watch` before manifest admission or static rendering.
2. Stop internal navigation from emitting retired English homepage aliases.
   Generic English goes to `/watch`; English accent or regional selections go
   to their existing language inventory when a language-specific destination
   is required.
3. Publish one `/watch` homepage sitemap entry with `en` and `x-default`
   self-targets, and remove regional English homepage locations and alternates.
4. Preserve exact English Dub slugs, language inventories, video and episode
   routes, and their BCP-47 HTML language identities.
5. Keep Watch page-head hreflang absent.

## Constraints

- Do not remove or merge any Language or Dub identity.
- Do not redirect language inventory, video, or episode routes.
- Do not change non-English localized homepage behavior.
- Do not add page-head hreflang; Watch sitemap XML remains the sole owner.
- Do not rewrite the completed `feat-302` history beyond its dated supersession
  note and reverse dependency.

## Verification

- Focused proxy tests cover direct permanent redirects, query preservation,
  internal-prefix handling, and unchanged deep English-audio routes.
- Route-builder and navigation tests prove Forge emits `/watch` or the exact
  English-audio inventory rather than a retired homepage alias.
- Sitemap tests prove one `/watch` entry with only `en` and `x-default`, with no
  regional English homepage location or alternate.
- Locale tests retain regional HTML language identities for English-audio
  inventory and media pages.
- Web typecheck, lint, build, focused browser QA, and `git diff --check` pass.
