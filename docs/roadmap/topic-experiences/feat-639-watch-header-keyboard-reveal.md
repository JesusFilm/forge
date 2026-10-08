---
id: "feat-639"
title: "Reveal the Watch header through keyboard focus"
owner: "vladmitkovsky"
priority: "P2"
status: "in-progress"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "watch"
  - "accessibility"
---

## Problem

When hero player chrome hides, the Watch header becomes inert and cannot be reached or revealed through keyboard navigation.

## Scope

- Keep the header available to keyboard navigation while its hero reveal zone is active.
- Reveal player chrome when keyboard focus enters the header.
- Keep the header out of the accessibility tree only when it is unavailable and does not contain focus.
- Verify focus and inert behavior in `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`.

## Verification

- Run the focused FloatingSearchProvider tests, Web typecheck, and scoped lint.
- Check the diff and ensure `/watch` rendering and loading behavior are unchanged.
