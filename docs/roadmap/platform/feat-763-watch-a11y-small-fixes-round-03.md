---
id: "feat-763"
title: "Small Watch accessibility fixes from the round-03 audit"
owner: "vlad"
priority: "P3"
status: "not-started"
start_date: "2026-10-21"
duration: 2
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch"
  - "ui"
  - "accessibility"
---

## Problem

The 2026-10-20 round-03 audit
(`docs/reports/2026-10-20-watch-website-audit-round-03.md`) found these small
issues. Open PRs do not cover them:

1. **What's new vote list loses list semantics.** `WhatsNewFeatureVote.tsx`
   renders `<ul role="group">` around `<li data-testid="whats-new-vote-card">`.
   The `group` role removes the list, so the 11 `<li>` are no longer list items
   (axe `listitem`, 11 nodes on `/watch/whats-new`).
2. **Empty or slug-named home cards.** On `/watch/spanish-latin-american.html`,
   10 `CarouselVideo` cards have an empty title. The link name is "Mostrar " and
   the `<h3>` is empty (axe `empty-heading`). Others are named by raw slugs
   ("Mostrar lumo-acts-1-1-8-3"). `CarouselVideo.tsx` uses
   `item.titleOverride ?? item.video?.title ?? ""`. The missing titles are Admin
   content data. The renderer should still never ship an unnamed link.
3. **Chapter card names repeat the title.** On `/watch/jesus.html`, each chapter
   link reads "The Beginning thumbnail Chapter The Beginning": the image alt
   repeats the visible title. Home cards do the same (axe
   `image-redundant-alt`, 52 nodes on `/watch`).
4. **What's new low-contrast labels.** Measured: "What is working" label
   `#b5afab` on `#ffffff` = 2.16:1. Vote counts `#858381` on `#f7f5f1` = 3.46:1.
   "Vote for features" `#7d7c7c` on `#ffffff` = 4.16:1. All are normal-size text
   (WCAG 2.2 SC 1.4.3 needs 4.5:1).

## Entry Points — Read These First

1. `apps/web/src/components/whats-new/WhatsNewFeatureVote.tsx` (around the `<ul role="group">`).
2. `apps/web/src/components/sections/CarouselVideo.tsx` (`title` fallback, `aria-label`).
3. The chapter carousel card component used on film pages (grep `thumbnail` alt).
4. `apps/web/src/components/whats-new/*` text colour classes (`text-[#2c1a0e]/35`, `text-[#131111]/50`, `/55`).

## Grep These

- `role="group"`
- `showVideo`
- `` `${title} thumbnail` `` or `thumbnail"` alt strings
- `text-[#2c1a0e]/35`

## What To Build

1. Put `role="group"` and its label on a wrapper (or drop the role), and keep `<ul>/<li>`.
2. Skip cards whose resolved title is blank, or fall back to a non-slug label. Report the missing titles to the content owners.
3. Give card images `alt=""` when the link text already contains the title.
4. Raise the What's new label/count colours to at least 4.5:1 against their measured backgrounds.

## Constraints

- Do not touch voting writes or analytics.
- Do not overlap open PRs #2637 (skip link/landmarks), #2669 (navigation contrast/targets), #2663 (search modal focus), #2740 (player keys) or #2752 (layout nits).

## Verification

- axe on `/watch/whats-new`, `/watch`, `/watch/spanish-latin-american.html` and `/watch/jesus.html` shows no `listitem`, `empty-heading` or `image-redundant-alt`.
- Unit tests per component. Contrast values re-measured in a real browser.
