---
id: feat-150
title: Catalog-driven watch UI locale fallback
status: "complete"
priority: high
area: platform
tags:
  - web
  - watch-page
  - i18n
  - routing
depends_on:
  - feat-148
blocks:
  - feat-151
  - feat-159
---

## Problem

Watch URLs currently choose UI chrome locale through a hardcoded family whitelist in `apps/web/src/lib/locale.ts`. Public audio slugs like `russian.html` correctly identify Russian content/audio, but because `ru` is not in the whitelist and there is no `apps/web/messages/ru.json`, the internal route rewrites to English UI.

The desired behavior is catalog-driven:

- Public watch audio slug validation remains in place.
- UI chrome locale is selected from available message catalogs.
- A requested language falls back to the closest available mapped catalog, then to English.
- Adding `apps/web/messages/ru.json` should make `russian.html` use Russian UI without changing a TypeScript whitelist.

## Entry Points

- `apps/web/src/lib/locale.ts`
- `apps/web/src/i18n/locales.ts`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
- `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx`
- `apps/web/src/app/api/revalidate/route.ts`
- `apps/web/src/lib/language-bcp47-map.ts`
- `apps/web/messages/*.json`

## Grep These

- `UI_LOCALE_FAMILIES`
- `resolveUiLocale`
- `resolveWatchLocaleIdentity`
- `AVAILABLE_UI_LOCALES`
- `isLocale(`
- `publicWatchAudioLanguageSlugForLocale`
- `messages-parity`

## What To Build

Implement `docs/plans/2026-05-31-001-fix-watch-catalog-driven-ui-locale-plan.md`.

The expected design is an edge-safe generated UI catalog module derived from `apps/web/messages/*.json`, used by watch locale resolution, proxy middleware, app route bounds, revalidation fanout, and tests. Do not import filesystem-based discovery into proxy or client-safe modules.

## Constraints

- Keep public audio slug and route-manifest admission separate from UI catalog selection.
- Do not make arbitrary BCP47 strings valid public watch audio slugs.
- Do not import `server-only` or Node `fs` modules into `apps/web/src/lib/locale.ts`, `apps/web/src/proxy.ts`, or client-safe route helpers.
- Do not commit a placeholder Russian catalog unless explicitly requested.
- Preserve static watch route behavior from feat-148.

## Verification

- `pnpm --filter @forge/web test -- src/lib/locale.test.ts`
- `pnpm --filter @forge/web test -- src/proxy.test.ts`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts`
- `pnpm --filter @forge/web test -- src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
- `pnpm --filter @forge/web test -- src/app/api/revalidate/route.test.ts`
- `pnpm --filter @forge/web typecheck`
- Helium smoke for `/watch/parable-of-the-pharisee-and-tax-collector.html/russian.html`, proving English UI without `ru.json` and Russian UI only when a real `ru` catalog exists.
