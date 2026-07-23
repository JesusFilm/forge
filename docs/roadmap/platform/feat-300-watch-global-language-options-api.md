---
id: "feat-300"
title: "Watch global language options API"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on:
  - "feat-260"
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "reliability"
---

## Problem

Opening the global language picker on public Watch pages fails with the generic
connection error. Production sends the lazy language catalog request as a
Next.js Server Action POST to the current public page URL, but the public
Cloudflare Watch route returns a plain-text 404 for that POST before the Web
application can run the action.

## Entry Points - Read These First

1. `apps/web/src/lib/watch-interaction-loader.ts` - lazy global language option
   loading, request deduplication, retry eviction, and in-memory result cache.
2. `apps/web/src/lib/watch-language-actions.ts` - current Server Action boundary
   for both page-specific and global language options.
3. `apps/web/src/lib/search-language-actions.ts` - cached Admin-backed language
   metadata source used by the global picker.
4. `apps/web/src/components/watch/GlobalLanguagePickerModal.tsx` - global modal
   loading, empty, error, retry, and selection states.
5. `apps/web/src/app/api/beta-tester-cta/route.ts` - existing read-only Watch API
   route and no-store response pattern.

## Grep These

- `loadGlobalWatchLanguageOptions`
- `getSearchLanguageCatalogOptions`
- `globalLanguageOptionsLoader`
- `Please check your connection and try again`
- `/watch/api/`

## What To Build

1. Add a read-only Watch route handler that projects and returns the compact
   global language option catalog through the production-supported
   `/watch/api/*` ingress.
2. Change only the global language option loader to call that GET endpoint;
   preserve lazy loading, concurrent-request deduplication, successful-result
   caching, and failed-request retry eviction.
3. Validate the response shape before returning it to the modal and surface
   upstream or malformed responses through the existing retryable error state.
4. Keep page-specific playable-language loading on its existing action boundary
   in this focused repair.

## Constraints

- Do not eagerly include the language catalog in the initial page payload.
- Do not expose Admin credentials or raw upstream errors to the browser.
- Do not change public Watch language URLs, language selection behavior, or
  preference writes.
- Do not hand-edit generated GraphQL or locale artifacts.
- Preserve the current search-language metadata cache and projection rules.

## Verification

- Focused route-handler tests cover success, no-store behavior, and safe 503
  failure.
- Focused interaction-loader tests prove the default global loader uses a GET
  under `/watch/api/`, validates the payload, and remains retryable.
- Existing global modal and interaction-loader suites remain green.
- `pnpm --filter @forge/web typecheck`
- Browser smoke on `/watch/english-british.html` proves the modal loads language
  choices, changing language navigates canonically, and no failed page POST is
  emitted.

## Plan

Implementation plan:
`docs/plans/2026-07-23-001-fix-watch-global-language-catalog-loading-plan.md`

## Completion Evidence

- Production reproduction captured a Cloudflare-owned `404 text/plain` for the
  page-bound Server Action POST on `/watch/english-british.html`.
- The global catalog now loads from `GET /watch/api/language-options`; focused
  route, loader, and modal suites pass 31 tests.
- Web typecheck and lint pass, and the production build includes the new route
  as a dynamic handler.
- Isolated Admin + Web browser proof used 2,303 restored languages and rendered
  2,260 valid public picker options at desktop and compact widths.
- Browser network capture shows `GET 200` for both the page and catalog, with no
  page POST. Selecting Spanish, Castilian navigates once to
  `/watch/spanish-castilian.html` and loads the Spanish UI catalog.
- Blocking the catalog GET once produced the localized retry state; unblocking
  and selecting Retry restored all 2,260 options.
