---
id: "feat-418"
title: "Watch subtitle discoverability and hydration"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-22"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "subtitles"
  - "accessibility"
  - "i18n"
  - "performance"
---

## Problem

A returning multilingual-group facilitator could no longer identify subtitles
after the Watch UI changed. Current production proof shows offered Afrikaans
Forge and translated tracks loading through the same-origin VTT path with
`readyState === 2`, so the remaining defects are the ambiguous/glyph-only
subtitle affordances and a Xhosa-only React hydration mismatch in hero metadata.

Tracking issue: [Linear FGE-92](https://linear.app/jesus-film-project/issue/FGE-92).
The Help Scout source remains read-only through that issue. Do not include
customer-identifying information or send a support reply from this scope.

Implementation contract:
[`docs/plans/2026-08-22-0314-fix-watch-subtitle-discoverability-plan.md`](../../plans/2026-08-22-0314-fix-watch-subtitle-discoverability-plan.md).

## Entry Points — Read These First

1. `docs/plans/2026-08-22-0314-fix-watch-subtitle-discoverability-plan.md` — product, implementation, and verification contract.
2. `apps/web/src/components/watch/HeroPlayer.tsx` — pre-reveal subtitle metadata, subtitle-specific switcher gate, localized hero counts, and Forge track injection.
3. `apps/web/src/components/watch/HeroPlayerControls.tsx` — sound-on audio/subtitle controls, compact codes, and fullscreen chrome.
4. `apps/web/src/components/watch/SeriesPageClient.tsx` and `apps/web/src/components/watch/SeriesHero.tsx` — series-trailer propagation of server-localized hero count labels.
5. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` — server route projection and client payload pruning.
6. `apps/web/src/lib/content.ts` — `WatchHeroPlayerBlock` and synthetic hero construction.
7. `apps/web/src/components/watch/WatchPageClient.tsx` — subtitle preference, availability, modal staging, and selected-track ownership; preserve this flow.
8. `apps/web/src/components/watch/__tests__/HeroPlayer.test.tsx`, `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`, `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`, `apps/web/src/components/watch/__tests__/SeriesHero.test.tsx`, `apps/web/src/components/watch/__tests__/SeriesPageClient.test.tsx`, and `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx` — focused regression surfaces.
9. `docs/solutions/ui-bugs/watch-subtitle-vtt-proxy-account-gate.md`, `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`, and `docs/solutions/conventions/frontend-change-page-load-performance-verification.md` — delivery, chrome, accessibility, and performance constraints.

## Grep These

- `languageCountLabel|subtitleLanguageCountLabel|languageCount`
- `hasLanguageSwitcher|hasSubtitleSwitcher`
- `hero-player-subtitle-language-count`
- `hero-chrome-subtitles|showSubtitleLanguageCode`
- `subtitlesHeading|toggleOff|languageCount`
- `FORGE_SUBTITLE_TRACK_LABEL|readyState`
- `data-modal-state="language"|watch_language_picker_opened`

## What To Build

1. Serialize localized audio- and subtitle-language count labels at the server route projection and render those stable values through `WatchHeroPlayerBlock` so browser ICU cannot change the first client render. Baseline proof is `2 285 iilwimi` in server HTML versus `2,285 iilwimi` after Xhosa hydration; runtime stays `128 min` and must remain unchanged.
2. Give the pre-reveal subtitle metadata explicit localized subtitle identity plus the offered Language count.
3. Use `hasSubtitleSwitcher`, not the multi-audio gate, to make offered subtitles interactive when a modal callback exists.
4. Show a compact visible subtitle state in player chrome for disabled, same-audio, and translated selections while retaining the localized accessible name and existing callback.
5. Preserve normalized availability, same-audio defaults, explicit translated preferences, unavailable states, modal staging, and same-origin track injection.
6. Cover English, Afrikaans, and Xhosa through focused component/route tests plus SSR/hydration, browser accessibility, native track, responsive-fit, and page-load evidence.
7. Record the validated outcome in `docs/solutions/ui-bugs/watch-subtitle-discoverability-hydration.md`.

## Constraints

- Do not modify `/watch/api/download`, subtitle-target resolution, authentication, CORS, or the completed FGE-67 delivery contract without new `readyState === 3` evidence.
- Do not create or imply Xhosa subtitle catalog data. Missing Xhosa availability is a separate residual, not a failed offered track.
- Do not change `WatchPageClient` preference persistence, modal ownership, language navigation, analytics, or option loading.
- Do not add catalog keys, dependencies, browser requests, eager media work, or initial modal loading.
- Do not broaden into FGE-70 JESUS discovery or FGE-75 Life of Jesus Chapter context.
- Do not hand-edit generated GraphQL artifacts, deploy production, or send a Help Scout reply.

## Verification

- Run focused `HeroPlayer`, `HeroPlayerControls`, `LanguagePickerModal`, `SeriesHero`, `SeriesPageClient`, and catch-all route Vitest suites.
- Run Web typecheck, changed-file lint, locale/catalog drift checks, production build, changed-file formatting, and `git diff --check`.
- Regenerate the roadmap index with `pnpm --filter roadmap generate:readme`.
- Browser-test one JESUS title in English, Afrikaans, and Xhosa. Verify server/hydrated text parity, zero React #418, both subtitle entry points, keyboard/focus behavior, truthful availability, and lazy modal loading.
- At desktop, 320/375 portrait, and compact landscape, verify control fit, touch targets, focus rings, and no horizontal overflow.
- Reconfirm an offered Afrikaans Forge track reaches `readyState === 2` with cues through the same-origin URL.
- Compare the pinned final merge base and branch for initial requests, transferred bytes, eager resources, long tasks, LCP, CLS, and the modal interaction window. Record exact results and honest skips in the solution note and PR.
