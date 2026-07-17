---
id: "feat-264"
title: "Watch language modal link localization"
owner: "codex"
priority: "P1"
status: "in-progress"
start_date: "2026-07-16"
duration: 1
depends_on:
  - "feat-256"
blocks: []
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
3. Add contextual copy to authored catalogs and preserve exact English-source cloning only for catalogs currently marked provisional.
4. Extend generator write mode to refresh only manifest-listed provisional catalogs after the English source changes.
5. Add regression coverage proving the links and accessibility labels are translator-driven and that catalog parity/provisional ownership still hold.

## Constraints

- Preserve the public audio-language route builders and draft-language update behavior from feat-256.
- Preserve the intentionally five-language tooltips documented in `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`.
- Do not change locale routing, catalog ownership policy, or language-selector bilingual row design.
- Keep the modal mobile-safe and keyboard accessible.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/LanguagePickerModal.test.tsx src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web typecheck`
- `pnpm --filter @forge/web lint`
- Browser-smoke the Russian modal at mobile and desktop widths, checking localized visible copy, accessible names, links, and horizontal overflow.
