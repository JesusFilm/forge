---
id: feat-189
title: Watch UI known-language catalog promotion
status: "complete"
priority: high
area: platform
tags:
  - web
  - watch-page
  - i18n
  - localization
depends_on:
  - feat-156
blocks: []
---

## Problem

`feat-156` intentionally seeded many official-language UI catalogs from
`apps/web/messages/en.json` so Watch routes could exercise catalog-driven
locale identity before reviewed translations existed. Those English-seeded
catalogs now make localized Watch URLs render English app chrome even when the
audio, transcript, and HTML language identity are correct.

The immediate Romanian report shows the gap: `/watch/jesus.html/romanian.html`
rewrites to the `ro` UI catalog, but `apps/web/messages/ro.json` is still an
English provisional copy.

## Entry Points

- `apps/web/messages/*.json`
- `docs/i18n/watch-ui-provisional-catalogs.json`
- `apps/web/scripts/generate-provisional-ui-catalogs.mjs`
- `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `apps/web/src/i18n/__tests__/messages-parity.test.ts`

## What To Build

- Promote a reviewable set of high-confidence English-seeded UI catalogs into
  localized app-chrome catalogs.
- Preserve ICU placeholders, JSON structure, and message-key parity.
- Remove promoted locales from the provisional manifest so the generator no
  longer requires them to remain exact English copies.
- Finish obvious English leftovers in already-authored catalogs where the
  translation is straightforward and context is clear.
- Keep low-confidence languages provisional instead of inventing dubious copy.

## Constraints

- Do not change public Watch URL shape.
- Do not translate video metadata, transcripts, subtitles, audio, or Admin
  localized content in this ticket.
- Do not overwrite existing authored translations except for English-valued
  leftovers.
- Do not mark a catalog as authored unless it no longer matches `en.json`.
- Preserve all placeholders such as `{count}`, `{query}`, `{suggestion}`, and
  ICU plural blocks.

## Verification

- `pnpm --filter @forge/web check:provisional-ui-catalogs`
- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- Spot-check Romanian Watch HTML or local browser smoke for visible localized
  chrome.
