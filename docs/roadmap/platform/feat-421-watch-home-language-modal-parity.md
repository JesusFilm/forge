---
id: "feat-421"
title: "Watch home language modal parity"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-08-24"
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

The global language picker used on the Watch homepage and utility pages has a
boxed dialog treatment that differs from the language picker on video and
series pages. This makes the same global language action feel like a separate
experience. The global surface should use the established inner-page language
picker presentation without exposing subtitle controls where no player exists.

## Entry Points - Read These First

1. `apps/web/src/components/watch/GlobalLanguagePickerModal.tsx` - global
   catalog loading, canonical route-family navigation, and current boxed UI.
2. `apps/web/src/components/watch/LanguagePickerPresentation.tsx` - shared
   modal frame, language structure, multilingual tooltips, and actions.
3. `apps/web/src/components/watch/LanguagePickerModal.tsx` - inner-page owner of
   playable-language and subtitle behavior.
4. `apps/web/src/components/watch/LanguageCombobox.tsx` - shared searchable
   language selection control.
5. `apps/web/src/components/FloatingSearchProvider.tsx` - lazy ownership of the
   global modal on the homepage and utility routes.

## Grep These

- `GlobalLanguagePickerModal|LanguagePickerModal`
- `watch-language-picker-language-header|global-language-picker-modal`
- `MultilingualTooltip|LanguageCombobox`
- `languageSwitcherTarget|languageVideosIndexPath`

## What To Build

1. Restyle the global language picker with the same transparent overlay,
   spacing, language header, catalog links, combobox, actions, and multilingual
   tooltip behavior used by the inner-page picker.
2. Reuse structural presentation components for the header, catalog links,
   combobox frame, multilingual tooltips, and actions rather than creating a
   second visual vocabulary.
3. Keep the global surface language-only: do not render subtitle headings,
   toggles, selectors, availability copy, or translation requests.
4. Preserve lazy catalog loading, retry and empty states, focus restoration,
   preference writes, pending navigation feedback, and route-family-aware
   destinations.

## Constraints

- Keep the modal module off the initial critical path; its existing post-load
  idle warmup may continue, but do not request the global catalog before the
  modal opens.
- Do not change language availability, URL contracts, or preference ordering.
- Do not add subtitle controls to routes without a player.
- Do not hand-edit generated GraphQL or locale artifacts.

## Verification

- Focused global language picker tests cover visual structure, absence of
  subtitles, loading/error/empty states, focus, and navigation behavior.
- Existing inner-page language picker tests remain green.
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser smoke on the Watch homepage at desktop and mobile widths.

## Completion Evidence

- The global picker now uses the inner-page transparent modal frame, language
  header, catalog links, combobox, multilingual tooltips, and close/apply
  actions while rendering no subtitle controls.
- Focused global and inner-page picker suites plus provider, interaction
  loading, and viewport-close coverage pass 206 tests after rebasing onto the
  latest `main`.
- Web TypeScript, full ESLint, Prettier, locale-catalog drift, and diff checks
  pass.
- The modal remains behind the existing `next/dynamic` boundary and may warm
  only after page-load idle; it stays unrendered before activation and the
  catalog request remains gated on opening. Shared presentation lives in a
  dedicated module, so the global interaction path does not import the full
  subtitle-capable inner modal.
- Local desktop and 390 px browser checks confirm the global error-state modal
  has no horizontal overflow or subtitle UI, exposes one accessible close
  control inside the dialog tree, restores focus to the trigger, and keeps the
  catalog count hidden while its value is unknown. Ready-state browser data
  was unavailable because the isolated admin service was not running; the
  ready, empty, retry, focus, and navigation paths remain covered by component
  tests.
