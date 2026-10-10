---
id: feat-631
title: Watch keyboard navigation landmarks
status: complete
priority: P1
owner: vlad
blocks:
  - feat-672
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

## Tracking

- Linear: FGE-204
