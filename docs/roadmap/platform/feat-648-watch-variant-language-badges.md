---
id: "feat-648"
title: "Distinguish Watch player language variants in chrome"
owner: "codex"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - web
  - watch-page
  - i18n
---

## Problem

The compact audio-language badge displays only the primary BCP-47 subtag. This makes distinct public languages sharing a primary tag indistinguishable in the Watch player chrome, including Portuguese, Portugal and Portuguese, Mozambique, and Korean and Korean, North.

## Entry Points

- `apps/web/src/lib/language-code.ts`
- `apps/web/src/lib/language-code.test.ts`
- `apps/web/src/components/FloatingSearchProvider.tsx`
- `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- `apps/web/src/components/watch/SeriesPageClient.tsx`
- `apps/web/src/components/watch/HeroPlayer.tsx`
- `apps/web/src/components/watch/HeroPlayerControls.tsx`
- `apps/web/src/components/watch/__tests__/HeroPlayerControls.test.tsx`

## What To Build

- Preserve the existing compact language code for languages without a distinguishable locale variant.
- Include the BCP-47 script, region, extlang, or variant discriminator where present; abbreviate private-use identifiers while retaining enough characters to distinguish catalog entries.
- Derive the badge from the selected public language slug when the route owns the selected language, and from variant language metadata otherwise.
- Make the control's accessible name identify the same selected variant.

## Constraints

- Use unique public language slugs as language identity; BCP-47 is descriptive metadata and may be shared.
- Do not alter playback selection, preference identity, routing, or translation content.
- Keep ordinary badges (for example English and Russian) unchanged.

## Verification

- Unit coverage distinguishes Portuguese regional variants, Korean/Kurmanji, Arabic dialect/extlang variants, Malagasy codes, and Chinese script/region variants.
- Unit coverage preserves the French / French African distinction and existing ordinary codes.
- Every mapped public slug receives a distinct badge, and the longest current badge remains within 10 characters.
- Focused player and chrome tests, Web typecheck, ESLint, and formatting.

## Completion Evidence

- Portuguese, Portugal and Mozambique display `PT-PT` and `PT-MZ`; Korean, Korean North, and Kurmanji display `KO`, `KO-NOR`, and `KO-KMR`; Arabic and Malagasy variants retain their distinct BCP-47 suffixes; French and French African remain `FR` and `FRA`.
- Player controls and the floating header pair accessible language names with the same source as each displayed code. Long badge text is capped at 7rem.
- Collision maps are built lazily on first badge lookup, not at module import; a local TSX probe measured 6.7 ms for that first lookup across the 2,329-entry map.
- Focused language-code, player, and floating-header tests pass (331 passed, 1 existing todo). Web typecheck and formatting pass. Focused ESLint passes with the existing `react-hooks/preserve-manual-memoization` baseline violations in `FloatingSearchProvider.tsx` suppressed for this check.
