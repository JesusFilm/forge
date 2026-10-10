---
id: "feat-684"
title: "Translate the Watch category rail arrow labels"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-12"
duration: 2
depends_on:
  - "feat-681"
blocks: []
tags: [web, watch, i18n]
---

## Problem

feat-681 added two arrow labels to the Watch home category rail. They exist in
`apps/web/messages/en.json` and, as honest English source fallback, in all 225
catalogs. Both paths are listed in `pendingTranslationPaths`, so provenance
digests do not claim a translation that never happened.

## Entry Points

1. `apps/web/scripts/ui-translation-policy.json` - remove the two paths when translated.
2. `apps/web/messages/*.json` - `WatchHomeCategories.previous` and `WatchHomeCategories.next`.
3. `docs/i18n/watch-ui-provisional-catalogs.json` - per-locale provenance digests.

## Grep These

- `WatchHomeCategories.previous`
- `WatchHomeCategories.next`

## What To Build

Contextually translate the two strings for every machine-translated catalog
(English: "Previous categories" / "Next categories"). They are direction-neutral
logical labels: the control sits on the inline-start / inline-end edge, so RTL
locales must not swap the words. Then remove both paths from
`pendingTranslationPaths` and refresh per-locale digests, following
`docs/roadmap/topic-experiences/feat-266-watch-collection-download-localization.md`.

## Constraints

- Do not run an unreviewed translator over the catalogs from an unrelated PR.
- Keep `en` and `ru` human-review ownership unchanged.

## Verification

- `pnpm --filter @forge/web test -- messages-parity.test.ts watch-ui-provisional-catalogs.test.ts`
- `pnpm --filter @forge/web check:provisional-ui-catalogs`
