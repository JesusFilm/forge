---
id: "feat-637"
title: "Fall back from blank language-inventory artwork"
owner: "vlad"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "media"
---

## Goal

Use the Mux frame fallback when a language-inventory card has no authored image or an empty-string image URL.

## Entry points

- `apps/web/src/components/watch-language-inventory/LanguageInventoryPage.tsx`
- `apps/web/src/components/watch-language-inventory/__tests__/LanguageInventoryPage.thumbnails.test.tsx`

## Verification

- Keep existing null-artwork fallback coverage and add a blank-string fixture.
- Run focused thumbnail tests, Web typecheck, and lint.

## Tracking

- Linear: FGE-178
