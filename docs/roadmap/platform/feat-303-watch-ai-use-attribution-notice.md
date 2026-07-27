---
id: "feat-303"
title: "Watch AI use attribution notice"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-07-23"
duration: 1
depends_on: []
blocks: []
tags:
  - "platform"
  - "web"
  - "watch-page"
  - "seo"
  - "legal"
---

## Problem

Public Watch pages do not state an attribution condition for AI agents, large
language models, AI search engines, crawlers, or related automated systems that
extract site information for training, retrieval, generated answers, or
services provided to their users or clients.

## Entry Points - Read These First

1. `apps/web/src/components/home/WatchHomeFooter.tsx` - the shared server
   component rendered at the end of Watch home, experience, video, series, and
   episode surfaces.
2. `apps/web/src/components/home/__tests__/WatchHomeFooter.test.tsx` - focused
   footer structure and layering regression coverage.
3. `https://www.jesusfilm.org/terms/` - the existing site Terms of Use that the
   attribution notice should reference without attempting to replace.

## Grep These

- `WatchHomeFooter`
- `watch-home-footer`
- `Terms of Use`
- `AI use and attribution`

## What To Build

1. Add a distinct, server-rendered policy block immediately after the shared
   Watch footer.
2. State that AI use of page information for training, retrieval, generated
   responses, or client services is conditioned on identifying Jesus Film
   Project as the source and linking directly to the source page.
3. Link the notice to the existing Jesus Film Project Terms of Use.
4. Add focused coverage for the policy copy, Terms link, and direct DOM order
   after the footer.

## Constraints

- Keep the notice in the shared footer ownership boundary so all existing
  footer callers receive it without route-by-route duplication.
- Render policy copy on the server; do not add client JavaScript or data
  fetching.
- Do not imply that the visual notice alone technically enforces crawler
  behavior.
- Do not change existing footer navigation, links, layering, or layout.

## Verification

```bash
pnpm --filter @forge/web exec vitest run \
  src/components/home/__tests__/WatchHomeFooter.test.tsx \
  src/i18n/__tests__/messages-parity.test.ts
pnpm --filter @forge/web exec tsc --noEmit
pnpm --filter @forge/web exec eslint \
  src/components/home/WatchHomeFooter.tsx \
  src/components/home/__tests__/WatchHomeFooter.test.tsx
pnpm --filter @forge/web check:ui-locales
```

Browser-smoke `http://localhost:3110/watch/english.html` at desktop and
`390x844`. Confirm the notice is the footer's immediate next sibling, remains
subdued and readable, has no horizontal overflow, and introduces no console
errors or client-side data request.

## Resolution

- Added one server-rendered attribution notice after the shared Watch footer
  so every existing Watch page with that footer receives the same subdued
  policy copy without route-level duplication.
- Reduced its visual emphasis with smaller muted text, a visually hidden
  heading, compact spacing, and a low-contrast footer-adjacent surface.
- Linked the notice to the existing Jesus Film Project Terms of Use and kept
  the existing footer navigation and layout unchanged.
- Added focused DOM-order and copy coverage, then verified the affected Watch
  routes, type checking, linting, initial HTML, and desktop/mobile rendering.
