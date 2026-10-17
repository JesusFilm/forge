---
id: "feat-701"
title: "Add script-aware Watch font fallbacks"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-10-07"
duration: 2
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "i18n"
  - "performance"
---

## Problem

Watch currently declares a Latin-only fallback stack. On devices without the
requested writing system, non-Latin Watch pages can render with inconsistent
metrics or missing glyphs. Linear: FGE-181.

## What To Build

- Add local, licensed Noto subsets for Arabic, Hebrew, Devanagari, Thai, and
  Ethiopic with explicit Unicode ranges and append script-appropriate Noto
  families to the shared native fallback stack.
- Preload only the single subset selected from the resolved document
  `htmlLang`; Latin pages must not request an extra script font.
- CJK stays on the platform fallback stack in this change. Its multi-subset
  local font coverage is tracked separately in feat-702 because its asset and
  request cost needs its own measurement.

## Entry Points

1. `apps/web/src/lib/watch-font.ts`
2. `apps/web/src/app/globals.css`
3. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`
4. `apps/web/public/fonts/`

## Verification

- Verify script selection for Arabic, Hebrew, Devanagari, Thai, and Ethiopic
  document tags, plus no preload for Latin and unsupported scripts.
- Compare document resource requests for Latin and script-specific pages; only
  the matching subset should be preloaded.
- Run Web typecheck, focused layout tests, lint, and format checks.

## Validation repair — 2026-10-17

- Rebased PR #2608 onto `848ce82f8d675431c83d66aef3651953d4183b8d`.
  Font source, assets, and existing tests are unchanged from the offered
  `f5ed6d67ac29160b6b28503a0fc55cc2e2d20651` head. Rebase conflicts were confined
  to the generated roadmap index, resolved with the repository generator.
- Preserve Urdu's document-only `:root:lang(ur)` Nastaliq stack, 59,524-byte
  subset, raw-primary-subtag preload selection (`urd` remains Naskh), and
  prose/heading leading of 2/1.8. CJK remains in feat-702.
- The existing globals, root-layout, locale, and proxy suites pass unchanged:
  324 tests across four files. Full Web typecheck and ESLint, scoped Prettier,
  and UI-locale generation drift checks pass.
- Both guarded production build attempts finished unsuccessfully. The default
  Turbopack build cannot resolve `next/package.json` because the reused
  dependency links point outside its workspace root. The webpack attempt fails
  on `node:crypto` imported through `recommendation-consent.ts` into
  `RecommendationConsentShell.tsx`; those files are unchanged from current main
  and outside this unit's scope. No runnable build, screenshots, or full-app LCP
  evidence was produced. Human visual sign-off is blocked.
- Actual localized app acceptance remains pending. The available local QA
  Admin returns only `english`, `spanish`, and `spanish-latin-american` from
  `languages(limit: 10000)` and returns `null` for
  `watchVideoRouteSnapshotBySlug(locale: "ur", languageSlug: "urdu", slug: "jesus")`.
  A read-only content environment containing canonical Urdu home/video content
  and Arabic/Persian controls is needed for picker/card, clamped/fixed-height,
  mixed Latin/digit, font-network, screenshot, and baseline/LCP acceptance.
  The prior static Chromium font harness does not satisfy these app checks.
- Keep this ticket in progress until the remaining app/performance checks and
  human visual sign-off are complete.
