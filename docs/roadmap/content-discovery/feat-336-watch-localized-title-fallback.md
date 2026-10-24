---
id: "feat-336"
title: "Watch localized title fallback"
owner: "codex"
priority: "P1"
status: "complete"
start_date: "2026-08-05"
duration: 1
depends_on: []
blocks: []
tags:
  - "admin"
  - "web"
  - "watch"
  - "i18n"
---

## Problem

Watch language inventory and detail pages treat an existing localized row as
complete even when its title is empty. The localized row then blocks the
published English title, producing a raw slug on inventory cards and an empty
heading on the linked page. Arabic LUMO collections expose the failure while
their localized descriptions and surrounding UI correctly remain Arabic.

## Entry Points

1. `apps/admin/src/services/video.service.ts`
2. `apps/admin/src/services/video.service.test.ts`
3. `apps/web/src/lib/content.ts`
4. `apps/web/src/lib/content.test.ts`
5. `docs/plans/2026-08-05-002-fix-watch-localized-title-fallback-plan.md`

## What To Build

1. Resolve every inventory title from the first nonblank requested-language
   published title, then a nonblank published English title, then a humanized
   slug.
2. Preserve requested-language description, snippet, image alt, questions,
   and other localized fields when only the title falls back.
3. Apply the same title ladder to Watch detail roots, parents, and children so
   cards and their destinations remain consistent.
4. Treat empty and whitespace-only titles as absent and never select an
   unrelated language title.

## Constraints

- Preserve the existing GraphQL contract, route shapes, playback selection,
  inventory eligibility, counts, and ranking limits.
- Keep inventory title selection after candidate pre-limiting and before final
  title ranking; do not add per-card Web hydration.
- Public English fallback must use active published locale rows.
- Humanized slugs are a safety fallback, not a replacement for authored copy.

## Verification

- Focused Admin service tests cover requested, English, whitespace, unrelated
  locale, parent-title, and humanized-slug selection.
- Focused Web content tests cover field-level root, parent, and child title
  fallback without replacing localized descriptions.
- Admin and Web typechecks plus scoped lint pass.
- Browser smoke of the Arabic language inventory and a linked collection page
  confirms readable fallback titles, retained Arabic UI/copy, stable loading,
  and no browser errors.

## Completion Note

Completed on 2026-08-06.

- Inventory cards now choose a trimmed requested-language title, then a
  published English title, then a humanized slug without replacing requested
  localized metadata.
- Watch snapshot normalization applies the same field-level ladder to root,
  parent, and child titles.
- The representative Arabic inventory returned 659 items with zero blank or
  raw-slug titles. The known blank-Arabic LUMO record rendered
  `LUMO - The Gospel of Mark` while retaining its Arabic description.
- The first resolver request after restart completed in 0.96 seconds, the warm
  request in 0.175 seconds, and direct SQL execution in 77 milliseconds.
- In-app browser verification confirmed the Arabic RTL inventory and linked
  collection heading with no blank headings or browser console errors. Proof
  is stored in `output/playwright/watch-arabic-localized-title-fallback.jpg`
  and `output/playwright/watch-arabic-lumo-mark-detail.jpg`.
- This completion note records local verification only; no production deploy
  was performed.
