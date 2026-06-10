---
id: "feat-169"
title: "Watch Bible Quotes Visibility Flag"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-06-10"
duration: 1
depends_on:
  - "feat-144"
blocks: []
tags:
  - platform
  - web
  - watch-page
  - feature-flags
---

## Problem

The web watch page needs an operator-controlled way to hide the full Bible
Quotes band shown below video content. The existing
`forge.watch.youVersionBibleQuotes` flag only controls the YouVersion passage
panel and API fetch; it does not hide the carousel, promo card, or section-local
share button.

## Entry Points -- Read These First

1. `packages/feature-flags/src/registry.ts` -- shared LaunchDarkly flag keys.
2. `apps/web/src/lib/feature-flags.ts` -- web server-side feature flag helpers.
3. `apps/web/src/env.ts` -- server-side fallback env schema.
4. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` -- watch route
   server flag evaluation.
5. `apps/web/src/components/watch/WatchPageClient.tsx` -- watch-page prop
   threading into the renderer.
6. `apps/web/src/components/watch/WatchSectionRenderer.tsx` -- synthetic watch
   block dispatch, including `BibleQuotes`.
7. `apps/web/src/components/watch/BibleQuotesSection.tsx` -- rendered band,
   quote carousel, promo card, and share entry point.

## Grep These

- `forge.watch.youVersionBibleQuotes`
- `FORGE_WATCH_YOUVERSION_BIBLE_QUOTES_DEFAULT`
- `isWatchYouVersionBibleQuotesEnabled`
- `data-block-type="BibleQuotes"`
- `case "BibleQuotes"`

## What To Build

1. Add a default-off LaunchDarkly boolean flag:
   `forge.watch.hideBibleQuotes`.
2. Add the local fallback env var:
   `FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT=false`.
3. Evaluate the flag server-side on watch routes and pass a plain boolean into
   the watch renderer.
4. When the flag is enabled, hide the full synthetic watch-page Bible Quotes
   band, including the heading, quote cards, promo card, and section-local share
   button.
5. Keep generic Experience-page `BibleQuotesCarousel` blocks visible; this flag
   is scoped to the web watch-page band.

## Constraints

- Do not reuse `forge.watch.youVersionBibleQuotes`; it remains focused on the
  YouVersion passage panel and API calls.
- Do not expose LaunchDarkly SDK keys or use a client-side LaunchDarkly SDK.
- Keep default/off behavior identical to the current watch page.
- Do not change Bible Quotes content, card styling, carousel mechanics, or share
  modal behavior.
- Do not hand-edit generated GraphQL artifacts.

## Verification

- `pnpm --filter @forge/web test -- src/lib/feature-flags.test.ts`
- `pnpm --filter @forge/web test -- 'src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx' src/components/watch/__tests__/WatchSectionRenderer.test.tsx`
- `pnpm --filter @forge/web lint`
- `pnpm --filter @forge/web typecheck`
- `git diff --check`
- Local smoke: with no `LAUNCHDARKLY_SDK_KEY`,
  `FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT=false` renders the Bible Quotes band
  and `FORGE_WATCH_HIDE_BIBLE_QUOTES_DEFAULT=true` hides it.

## Operational Note

LaunchDarkly remote flag creation should use project `watch`, key
`forge.watch.hideBibleQuotes`, a temporary boolean flag, targeting off in all
environments, and default/off variation `false`. The MCP create/get step was
blocked locally by expired LaunchDarkly connector auth (`401 invalid_token`).
