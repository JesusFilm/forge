---
id: "feat-260"
title: "Watch global language switcher"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-15"
duration: 2
depends_on: []
blocks:
  - "feat-300"
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "i18n"
---

## Problem

The Watch floating header exposes language switching on single-video and series pages, but the homepage and other public Watch routes do not register a language control. Users cannot consistently change both translated UI chrome and language-scoped content from every page.

## Entry Points - Read These First

1. `apps/web/src/components/FloatingSearchProvider.tsx` - renders the shared floating header and consumes the language-switcher registration event.
2. `apps/web/src/components/watch/LanguagePickerModal.tsx` - existing single-page language selection, preference, pending-navigation, and canonical-route behavior.
3. `apps/web/src/components/watch/WatchPageClient.tsx` - single-video language modal ownership and lazy option loading.
4. `apps/web/src/components/watch/SeriesPageClient.tsx` - series-level header registration and language navigation.
5. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx` - shared public Watch layout and `next-intl` provider.
6. `apps/web/src/proxy.ts` and `apps/web/src/lib/routes.ts` - public language-slug URL contract that jointly selects UI and content language.

## Grep These

- `WATCH_HEADER_LANGUAGE_SWITCHER_EVENT|headerLanguageSwitcher` in `apps/web/src/`
- `openLanguage|LanguagePickerModal|writePreferredLanguageSlug` in `apps/web/src/components/watch/`
- `localizedHomePath|languageVideosIndexPath|parseWatchPath` in `apps/web/src/lib/routes.ts`
- `resolveWatchLocaleIdentity|isPublicWatchLanguageSlug` in `apps/web/src/lib/locale.ts`
- `classifyRewrite|history|languages` in `apps/web/src/proxy.ts`

## What To Build

1. Render a language switch affordance in the shared header on the Watch homepage and every public Watch page family.
2. Reuse the established single-page selection contract: validate the public language slug, persist the preference, navigate through canonical route builders, and keep pending navigation honest.
3. Make the selected public language slug drive both the `next-intl` UI catalog and the language-scoped content route, including localized public shapes for utility pages that must stay in place.
4. Preserve page-specific language availability on video and series pages while providing an appropriate global language set on routes without content-specific variants.
5. Add route-family and interaction regression coverage plus browser and page-load-performance evidence.

## Constraints

- Keep the public audio-language slug as the sole language carrier for localized Watch content; never emit internal UI locale keys in public URLs.
- Do not eagerly add the full language catalog or modal implementation to every page's initial payload.
- Do not hand-edit generated locale or GraphQL artifacts.
- Preserve the current single-video and series switcher behavior, subtitle behavior, and preference-cookie ordering.
- Do not let the global catalog override a content page that intentionally has no playable alternative language.
- Do not overwrite unrelated in-progress working-tree changes.

## Verification

- Focused Vitest coverage for shared header fallback ownership, global language selection, canonical navigation, preference writes, and page-specific override behavior.
- Route/proxy tests for every new or changed public language-bearing URL shape.
- Existing `LanguagePickerModal`, `WatchPageClient`, `SeriesPageClient`, and `FloatingSearchProvider` suites remain green.
- `pnpm --filter @forge/web typecheck`
- Browser smoke across home, video, series, languages, language inventory, history, and not-found surfaces.
- Page-load evidence confirms the shared switcher does not eagerly load the language catalog or modal chunk.

## Completion Evidence

- Web lint and TypeScript checks pass in a clean detached worktree.
- 467 affected tests pass with 2 existing todos; the provider suite passes 63 tests including page-owner, search, route-change, unmount, retry, and StrictMode ownership cases.
- Review fixes cover stale deferred intent, localized modal states, utility-route alias canonicalization, chunk-load recovery, and initial-bundle staging.
- The global modal and language catalog remain behind the interaction loader; the shared provider no longer imports the locale/router language graph for its fallback.
- Real-browser startup was attempted in the required isolated worktree. Windows Turbopack workspace-root inference failed before application code; webpack fallback failed on the repository's existing Datadog `node:` imports. Route-family behavior and loading posture are therefore covered by focused integration tests and source-level loader verification, with CI left as the production-build gate.
