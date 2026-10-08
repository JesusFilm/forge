---
id: feat-630
title: Watch home first screen promise
status: in-progress
priority: P1
owner: vlad
---

## Goal

Put a useful Watch page heading, free viewing promise, and current language count on the first screen.

## Scope

- Add a localized first-screen heading and description to the Watch home hero.
- Show the published language count and a link to the language index.
- Add a concise no-sign-up trust statement.
- Preserve a single page-level H1 when CMS-authored home content includes a heading.
- Keep all message catalogs structurally aligned.

## Verification

- Focused Watch home component tests and Web typecheck.
- Web lint and production build for the touched frontend scope.
- Confirm the added copy is present in the first hero viewport and catalog keys are complete.

## Tracking

- Linear: FGE-234
- Source count: `/watch/languages` listed 2,329 languages on 2026-10-08.
