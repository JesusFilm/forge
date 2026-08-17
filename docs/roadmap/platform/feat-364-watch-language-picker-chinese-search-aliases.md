---
id: "feat-364"
title: "Watch language picker Chinese search aliases"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-08-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "language-picker"
  - "i18n"
---

## Problem

The shared Watch language combobox searches display and native names only.
Chinese-speaking users may search with familiar terms such as `普通话`, `粤语`,
`简体中文`, or `繁體中文`, but those terms do not consistently appear in the
current option labels, so available languages can look missing.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguageCombobox.tsx` - shared filtering,
   ranking, keyboard navigation, and virtualization behavior.
2. `apps/web/src/components/watch/GlobalLanguagePickerModal.tsx` - global Watch
   language options and selection flow.
3. `apps/web/src/components/watch/LanguagePickerModal.tsx` - playable-audio and
   subtitle option boundaries.
4. `apps/web/src/lib/language-display.ts` - display and native-name derivation.
5. `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`
   - exact-slug language identity rule.

## Grep These

- `LanguageCombobox`
- `searchMatchTierForOption`
- `nativeNameForOption`
- `currentLanguageUnavailableSubtitleOption`
- `PUBLIC_WATCH_LANGUAGE_SLUGS`

## What To Build

1. Add one small client-safe alias authority keyed by exact public language
   slug, including the approved Mandarin, Cantonese, Simplified Chinese,
   Traditional Chinese, and broad `中文` discovery terms.
2. Extend `LanguageCombobox` with an optional alias authority while preserving
   existing direct-name ranking, stable caller order, keyboard behavior, and
   virtualization.
3. Enable aliases only for the global, playable-audio, and subtitle pickers.
4. Keep each picker's supplied options as the availability boundary so aliases
   never synthesize unavailable audio or subtitles.
5. Add focused structure, ranking, availability, integration, and non-Chinese
   regression tests.

## Constraints

- Bind aliases by exact public language slug; do not infer identity from a
  BCP-47 prefix or locale family.
- Do not map `台語` or `臺語` to Taiwan Mandarin or another Hokkien variety.
- Do not change language availability, routing, playback, subtitle selection,
  Watch content search, visible copy, or message catalogs.
- Do not enable the aliases for other `LanguageCombobox` consumers.
- Do not add a runtime dependency on the full public-language corpus, BCP-47
  map, URL aliases, or message catalogs.

## Verification

- Focused alias, combobox, global-picker, audio-picker, and subtitle-picker
  tests pass.
- English, Russian, native-name, keyboard, ARIA, and virtualization behavior
  remains unchanged.
- Web typecheck, lint, formatting, full tests, and production build pass.
- Browser smoke covers all three target pickers across English, Simplified
  Chinese, Traditional Chinese, and Russian Watch routes.
- Production-build and browser-network evidence show no new request or
  unexpected initial-load growth.
