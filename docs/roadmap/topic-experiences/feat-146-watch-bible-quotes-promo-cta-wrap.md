---
id: "feat-146"
title: "Watch Bible Quotes Promo CTA Wrap"
owner: "urim"
priority: "P2"
status: "complete"
start_date: "2026-06-13"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "ui"
  - "i18n"
---

## Problem

Long localized CTA labels in the Watch Bible Quotes promo card can be clipped on mobile. The card itself is rounded and `overflow-hidden`, while the shared pill button inherits `whitespace-nowrap`, so a label like the Russian Bible-study CTA can extend beyond the card instead of wrapping.

## Entry Points - Read These First

1. `apps/web/src/components/watch/BibleQuotesSection.tsx` - renders the Watch Bible Quotes carousel and trailing promo CTA.
2. `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx` - colocated component coverage for the promo CTA.
3. `apps/web/src/components/ui/button.tsx` - shared button variant that contributes the inherited nowrap behavior.
4. `apps/web/src/components/watch/watch-section-styles.ts` - Watch-specific pill sizing classes.

## Grep These

- `watch-bible-quotes-promo-cta`
- `WATCH_PILL_BUTTON_CLASS`
- `whitespace-nowrap`
- `joinBibleStudy`

## What To Build

1. Keep the shared button variant unchanged.
2. Override nowrap locally on the Watch Bible Quotes promo CTA.
3. Cap the CTA to the promo card's available width so the rounded card does not clip the label.
4. Preserve the external anchor behavior and existing Watch pill styling.

## Constraints

- Do not alter global pill-button behavior for unrelated UI.
- Do not change Bible Quotes data fetching or carousel geometry.
- Do not introduce new translation keys for this visual fix.

## Verification

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/BibleQuotesSection.test.tsx`
- Mobile browser smoke of a Watch page with the Bible Quotes promo card visible, verifying the CTA is not clipped.
