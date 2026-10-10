---
title: Fix Watch Bible Quotes Promo CTA wrapping
type: fix
status: completed
date: 2026-06-13
roadmap: docs/roadmap/topic-experiences/feat-146-watch-bible-quotes-promo-cta-wrap.md
---

# Fix Watch Bible Quotes Promo CTA wrapping

## Problem Statement

The Watch Bible Quotes promo card uses the shared pill button style inside an `overflow-hidden` image tile. The shared button includes `whitespace-nowrap`, so long localized CTA labels can extend beyond the card and be clipped by the rounded tile instead of wrapping within the available width.

## Scope

Fix the promo CTA in `apps/web/src/components/watch/BibleQuotesSection.tsx` so long labels stay visible on narrow mobile cards. Do not change the global `Button` variant, because other controls intentionally depend on one-line pill behavior.

## Implementation Units

### U1: Make the promo CTA width-aware

Files:

- `apps/web/src/components/watch/BibleQuotesSection.tsx`

Approach:

- Keep the CTA as the existing external anchor rendered through `Button`.
- Add local classes to override the inherited nowrap behavior, cap width to the card, and allow the label to break cleanly.
- Preserve the existing Watch pill sizing classes and external link attributes.

Verification:

- Long localized labels are not clipped inside the promo card.
- Existing short labels still render as a pill.

### U2: Add regression coverage

Files:

- `apps/web/src/components/watch/__tests__/BibleQuotesSection.test.tsx`

Approach:

- Extend the existing promo CTA test to assert the wrapping override classes are present.
- Keep the test focused on the local override, not browser layout math that jsdom cannot compute.

Verification:

- `pnpm --filter @forge/web test -- src/components/watch/__tests__/BibleQuotesSection.test.tsx`

## Browser Smoke

Use Helium/agent-browser for a mobile-sized smoke of a Watch page with the Bible Quotes promo visible. Confirm the promo CTA remains fully visible and wraps when the label is long enough to exceed the card width.
