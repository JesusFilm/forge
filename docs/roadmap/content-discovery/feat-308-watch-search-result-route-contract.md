---
id: "feat-308"
title: "Watch search result route contract"
owner: "codex"
priority: "P0"
status: "complete"
start_date: "2026-07-24"
duration: 1
depends_on:
  - "feat-254"
blocks: []
tags:
  - "web"
  - "watch"
  - "search"
  - "routing"
---

## Problem

Watch search can retain unavailable or malformed results and turn missing route
data into a clickable Watch homepage destination. Public cards must only expose
Admin actions that map to an admitted content-and-audio-language route.

## Entry Points - Read These First

1. `docs/plans/2026-07-24-001-fix-watch-search-result-routing-plan.md`
2. `apps/web/src/lib/search.ts`
3. `apps/web/src/lib/search-actions.ts`
4. `apps/web/src/components/search/VideoCard.tsx`
5. `apps/web/src/components/SearchOverlay.tsx`
6. `apps/web/src/lib/routes.ts`
7. `apps/web/src/lib/locale.ts`
8. `apps/web/src/proxy.ts`

## Grep These

- `mapWatchSearchResult` and `withResolvedLanguageSlug` in `apps/web/src/lib`
- `defaultHrefBuilder` in `apps/web/src/components/search`
- `isPublicWatchLanguageSlug` in `apps/web/src`
- `displayResults.length` and `hasMore` in `apps/web/src/components/SearchOverlay.tsx`

## What To Build

1. Consume Admin action kind, action language, availability, and fallback state
   as one route-admission contract.
2. Admit only audio-backed `WATCH` actions with valid public content and
   language slugs; suppress unavailable, contradictory, subtitle-only, and
   malformed results.
3. Advance through at most three consecutive source pages when filtering leaves
   a page empty, preserving the final Admin cursor.
4. Keep a cursor-advancing action available when the bounded drain still ends
   on an empty nonterminal page.
5. Make `VideoCard` reject invalid content slugs before invoking default or
   custom destination builders, with no homepage fallback.

## Constraints

- Do not broaden the existing public Watch URL character contract.
- Do not synthesize an action language from UI or resolved search language.
- Preserve valid underscore content slugs.
- Do not change Admin ranking, schema, or generated GraphQL artifacts.
- Keep FGE-25, FGE-26, and FGE-43 follow-up scope outside this focused route
  safety fix except for their narrow acceptance overlap recorded in the plan.

## Verification

- Focused Web search mapping, action, component, and provider tests pass.
- Web typecheck, lint, and format checks pass for the touched scope.
- A valid card opens its content-and-language route.
- `Tümlükden Nura` and `La_Busqueda_La Recherche` are absent for the FGE-2
  query fixtures and never produce `/watch`.
- The normal path makes one Admin request; empty-page draining stops after
  three requests and never repeats a cursor.
- Browser smoke covers `Иисус`, `Jesuus`, and `耶稣` with a valid navigation
  control and no homepage fallback.

Completed on 2026-07-24:

- 153 focused Web tests passed; Web typecheck and lint passed.
- Browser smoke against real Admin data omitted both named invalid results and
  every root/homepage result href for all three production-observed queries.
- The valid `JESUS` result opened `/watch/jesus.html/english.html`.
- Normal searches made one browser-to-server action request in 1.6-2.3 seconds;
  unit coverage proves a one-request normal Admin path and a three-request
  maximum for filtered source-page draining.
