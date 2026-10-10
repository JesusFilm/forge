---
id: "feat-675"
title: "Watch home first screen promise"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
  - "accessibility"
  - "seo"
---

## Problem

At 1280x800, production `/watch` showed the `Browse by category` H2 at y=488
and the page H1 (`Watch free Christian videos, Bible stories, and films`) at
y=936, below the first screen. Visitors did not see the page topic, the free
promise, or how many languages Watch offers before scrolling (Linear FGE-234,
W-098; measured 2026-10-09).

## Entry Points — Read These First

1. `apps/web/src/components/home/WatchHomeFirstScreen.tsx` — the first-screen
   H1, language count, language-index link, and trust statement.
2. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` — passes the
   first screen into the carousel and demotes authored H1s when it supplies
   the page H1.
3. `apps/web/src/components/home/WatchHomeTvCarousel.tsx` — renders
   `heroIntro` over the hero media.
4. `apps/web/scripts/ui-translation-policy.json` — `WatchHome.noSignUpToWatch`
   is a pending translation path.
5. `apps/web/scripts/openai-catalog-translator.mjs` — translation context for
   `WatchHome.noSignUpToWatch`.

## Grep These

- `WatchHomeFirstScreen`
- `watchHomeLanguageName`
- `WATCH_HOME_LANGUAGE_COUNT`
- `noSignUpToWatch`
- `heroIntro`

## What To Build

1. Render a visible H1, `LanguageInventory.heroTitle`, in the hero's first
   screen. Name the language from the page's `languageSlug` (the content
   language), not from the chrome catalog key.
2. Show the published language count with `LanguagePickerModal.languageCount`
   and link to `/watch/languages`. Keep the count a constant so the static
   home never fetches the language index before its first screen renders.
3. Add the trust statement `WatchHome.noSignUpToWatch` ("No sign-up needed to
   watch"). It claims only that viewing needs no account; downloads can still
   require sign-in.
4. Keep exactly one page H1. When the first screen renders it, demote authored
   H1 blocks to H2.
5. Render the first screen on the server. Do not add its namespaces to
   `WATCH_HOME_CLIENT_MESSAGE_NAMESPACES`.

## Constraints

- No request-time dynamic APIs in `src/app/[locale]/[htmlLang]/**`.
- No consent prerequisite for the first screen.
- Do not record machine translations without verifiable provenance. Until a
  translation run with recorded provenance, `WatchHome.noSignUpToWatch` stays
  in `pendingTranslationPaths` and every catalog holds the English source.
- Keep `crk` and `mey-Latn` byte-identical to `en.json`.

## Verification

- `pnpm --filter @forge/web exec vitest run src/components/home/WatchHomeFirstScreen.test.tsx src/components/home/WatchHomeExperiencePage.test.tsx 'src/app/[locale]/[htmlLang]/page.test.tsx' src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts scripts/translate-ui-catalogs.test.mjs src/i18n/client-messages.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- At 1280x800, the H1, language count, language link, and trust statement sit
  above y=800 on `/watch`.

## Follow-up

- Translate `WatchHome.noSignUpToWatch` with the catalog translation script and
  record its provenance, then remove it from `pendingTranslationPaths`.
- Recheck `WATCH_HOME_LANGUAGE_COUNT` when `/watch/languages` changes. It
  listed 2,329 languages on 2026-10-08 and 2026-10-09.
