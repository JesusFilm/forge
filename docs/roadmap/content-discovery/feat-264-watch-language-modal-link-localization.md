---
id: "feat-264"
title: "Watch language modal link localization"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-07-16"
duration: 1
depends_on:
  - "feat-256"
blocks:
  - "feat-265"
tags:
  - "web"
  - "watch"
  - "languages"
  - "i18n"
  - "content-discovery"
---

## Problem

The catalog links added to the Watch language modal render English literal
copy even when the page uses a localized message catalog. This produces mixed
Russian and English chrome and bypasses the catalog parity guarantees used by
the rest of the modal.

## Entry Points - Read These First

1. `apps/web/src/components/watch/LanguagePickerModal.tsx` - modal copy and the two catalog links introduced by feat-256.
2. `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx` - modal rendering, route, and selected-language behavior.
3. `apps/web/messages/en.json` and `apps/web/messages/ru.json` - source and Russian `LanguagePickerModal` namespaces.
4. `apps/web/src/i18n/__tests__/messages-parity.test.ts` - catalog structural-parity gate.
5. `docs/i18n/watch-ui-provisional-catalogs.json` - authored and provisional catalog ownership.

## Grep These

- `See all languages`
- `See all videos in`
- `Retry loading languages`
- `Not available`
- `Switching...`
- `LanguagePickerModal`
- `draftLanguageDisplay`

## What To Build

1. Move the catalog-link labels and remaining modal-owned retry, unavailable, and pending-navigation copy into the `LanguagePickerModal` message namespace.
2. Use the selected language's native display name in the localized inventory-link template, with the existing English display name as fallback.
3. Add contextual copy to all 224 non-English catalogs, preserving existing authored translations and recording machine-translation provenance for the remainder.
4. Complete the provisional catalog inventory and keep manifest policy, ownership, and source/catalog digests auditable.
5. Add regression coverage proving every modal message formats in every locale, the links and accessibility labels are translator-driven, and catalog/provenance parity holds.

## Constraints

- Preserve the public audio-language route builders and draft-language update behavior from feat-256.
- Preserve the intentionally five-language tooltips documented in `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`.
- Do not change locale routing or the language-selector bilingual row design. The user's expanded all-language requirement explicitly supersedes the original provisional English-clone policy.
- Keep the modal mobile-safe and keyboard accessible.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser-smoke the Russian modal at mobile and desktop widths, checking localized visible copy, accessible names, links, and horizontal overflow.

## Completion Evidence

- Verified the real Russian Watch route at
  `http://localhost:3022/watch/jesus.html/russian.html` with the language modal
  opened at desktop (1280px) and phone-sized (390x844) Chromium viewports.
- Both viewports rendered `Посмотреть все языки` and
  `Посмотреть все видео (русский)` with no `See all languages` or
  `See all videos` leakage. The links retained `/watch/languages` and
  `/watch/russian.html/videos`, and remained represented as focusable links in
  the accessibility snapshot.
- Phone-sized DOM measurements reported a 390px viewport, no document
  horizontal overflow, and a sheet bounded within the visual viewport.
- Opening the real-route modal produced no console errors or
  `MISSING_MESSAGE` diagnostics.
- Verified representative Russian, Arabic, and Japanese real-route modals after
  the all-language catalog pass. Each rendered locale-specific catalog links
  and actions with the expected public-language hrefs and no English leakage;
  Japanese also reported no console or missing-message errors.
- Verified all 18 `LanguagePickerModal` values across 223 localized
  non-English catalogs (4,014 localized values). Real `next-intl` formatting
  passed across all 225 catalogs with representative plural and `{language}`
  inputs.
- Reduced the provisional inventory from 201 catalogs to one: 225 total
  catalogs, one explicit English fallback (`mey-Latn`), 222 provenance-backed
  machine-translated catalogs, and `en`/`ru` retained as human-reviewed. Source
  and per-catalog SHA-256 digests are gated in tests; native-speaker review
  remains recommended for machine copy. Hassaniyya-Latin remains open because
  the available orthography and phrase corpus do not cover the modal's modern
  UI terminology, and the prior Spanish fallback was removed rather than
  mislabeled as localization.
- Confirmed the translation-only change adds no runtime imports or requests:
  request configuration still dynamically imports exactly one active catalog.
  Catalog payloads remain 8.7–17.9 KB (10.0 KB median; 15.9 KB p95), with
  representative `en` 9.0 KB, `ru` 12.9 KB, `ar` 11.9 KB, and `ja` 10.6 KB.
- Captured local proof at
  `.tmp/browser-proof/watch-russian-language-modal-desktop.png` and
  `.tmp/browser-proof/watch-russian-language-modal-390x844.png`.
- Attempted affected-browser verification on existing and fresh iOS Simulator
  devices. CoreSimulator stalled during device boot before Safari could launch;
  restarting the shared simulator service was intentionally avoided. The
  browser-independent catalog regression remains covered by real-route desktop
  and responsive browser proof plus component tests using real English,
  Russian, and Arabic catalogs.
- Passed focused component/catalog tests, provisional-catalog generation and
  locale checks, `@forge/web` typecheck, full web ESLint, Prettier, ICU parser
  and placeholder audits across 42,784 localized message values, and diff
  hygiene checks.
