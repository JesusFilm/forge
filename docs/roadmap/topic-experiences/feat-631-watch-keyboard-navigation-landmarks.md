---
id: feat-631
title: Watch keyboard navigation landmarks
status: in-progress
priority: P1
owner: vlad
---

## Goal

Let keyboard and screen-reader users reach Watch navigation and page content without traversing every content rail first.

## Scope

- Render the floating Watch header before page children in DOM order.
- Add a skip-to-main-content link before the Watch page content.
- Move the Watch home footer outside the main landmark.
- Give the skip link a stable, focusable main-content target.

## Verification

- Focused provider and Watch home tests assert skip link, header, main, and footer order.
- Web typecheck and lint.
- Production build for the touched frontend scope.

## Tracking

- Linear: FGE-204
