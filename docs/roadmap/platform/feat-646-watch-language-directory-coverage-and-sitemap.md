---
id: "feat-646"
title: "Expose the public Watch language directory and inventory URLs"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "i18n"
  - "seo"
---

## Problem

The Watch language directory is built from a live Admin metadata response, so
public language slugs missing from that response are omitted even though their
standalone inventory routes resolve. This leaves the directory incomplete and
makes its public language inventory routes undiscoverable to crawlers.

## Entry Points - Read These First

1. `apps/web/src/lib/language-index.ts`
2. `apps/web/src/components/watch/WatchLanguageIndexBrowser.tsx`
3. `apps/web/src/lib/watch-sitemap.ts`
4. `packages/watch-url-policy/src/public-watch-language-slugs.ts`
5. `apps/web/src/lib/language-bcp47-map.ts`

## What To Build

1. Keep Admin metadata authoritative for labels, country membership, flags, and speaker counts when available.
2. Ensure every valid slug in the compiled public Watch corpus appears in the language directory, with a readable BCP-47-derived or slug fallback label when Admin metadata is absent.
3. Add `/watch/languages` and every standalone `/{language}.html/videos` inventory URL to the Watch sitemap as canonical entries without fabricated hreflang alternates.
4. Preserve existing canonical video route groups, contextual-route exclusion, URL uniqueness, and sitemap byte/URL limits.

## Verification

- Focused language-index and Watch sitemap tests cover fallback coverage, discoverability, and standalone sitemap entries.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Sitemap chunk tests enforce the existing byte and URL ceilings.
