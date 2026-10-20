---
id: "feat-770"
title: "Watch keyboard navigation landmarks"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-08"
duration: 2
depends_on: []
blocks:
  - "feat-672"
tags:
  - "web"
  - "accessibility"
---

## Goal

Let keyboard and screen-reader users reach Watch navigation and page content without traversing every content rail first.

## Scope

- Render the floating Watch header before page children in DOM order.
- Add a skip-to-main-content link before the Watch page content.
- Move the Watch home footer outside the main landmark.
- Give the skip link a stable, focusable main-content target.

## Translation status

- `WatchAccessibility.skipToMainContent` is listed in
  `apps/web/scripts/ui-translation-policy.json` `pendingTranslationPaths`. That
  keeps it out of the per-locale source and catalog digests, so existing
  machine-translation provenance stays truthful: the OpenAI run never saw this
  string. It also exempts the path from the English-copy gates, which is the
  documented process for pending UI copy.
- The values in the other catalogs are provisional candidate values that came
  with this PR. They were not produced by `scripts/translate-ui-catalogs.mjs`
  and have not been reviewed by a speaker of the language. 15 non-provisional
  catalogs (`bjt`, `bsc`, `caa`, `cak`, `chp`, `den`, `dgr`, `dyo`, `gil`, `gwi`,
  `mh`, `na`, `pau`, `quc`, `quv`) and the two English-seeded provisional
  catalogs (`crk`, `mey-Latn`) still show the English text.
- Follow-up: feat-672 tracks verified translations for this path and removal
  from `pendingTranslationPaths` with refreshed provenance.

## Verification

- Focused provider and Watch home tests assert skip link, header, main, and footer order.
- Web typecheck and lint.
- Production build for the touched frontend scope.

## ID note

Opened as feat-631, but main already uses feat-631 for the TV development
harness. Renumbered to feat-770 on 2026-10-20 when main was merged into
PR #2637.

## Tracking

- Linear: FGE-204
