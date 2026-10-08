---
id: "feat-633"
title: "Keep Watch Home Content Available When the Hero Query Fails"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch"
  - "resilience"
---

## Problem

A transient failure in the Watch home hero query currently replaces the whole
page with an error state, even when the independently fetched authored homepage
body is available. This affects the root homepage and localized language-home
routes.

## Entry Points - Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/page.tsx` - root Watch homepage data
   loading and error handling.
2. `apps/web/src/app/[locale]/[htmlLang]/[...rest]/page.tsx` - localized
   language-home data loading and error handling.
3. `apps/web/src/components/home/WatchHomeExperiencePage.tsx` - authored body
   and hero rendering.
4. `apps/web/src/app/[locale]/[htmlLang]/page.test.tsx` and
   `apps/web/src/app/[locale]/[htmlLang]/[...rest]/__tests__/page-routing.test.tsx`
   - root and localized route coverage.

## What To Build

- Render available authored homepage blocks when the hero query fails.
- Supply an empty hero model so the page renderer can omit unavailable hero
  media while preserving the authored body and footer.
- Show the hero error only when no authored body can be rendered. Show the empty
  state only when both successful data sources contain no content.
- Cover root and localized homepage routes.

## Verification

- Run focused root and localized route tests.
- Run Web typecheck and scoped lint/format checks.
- Run `git diff --check` and regenerate the roadmap README.

## Resolution

- Root and localized language-home routes now keep rendering when the hero
  query fails but authored body blocks are available. The renderer receives an
  empty hero model, so it can omit the unavailable media and render the body.
- When no authored blocks are available after a hero failure, the route shows
  the existing error state. Empty state remains reserved for a successful but
  empty hero response with no authored blocks.
- Added route coverage for hero failure with body content and with no body.
- Focused root and localized route suites pass (106 tests); Web typecheck,
  scoped lint, formatting, and `git diff --check` pass.
