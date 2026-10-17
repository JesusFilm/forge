---
id: "feat-728"
title: "Finish Watch catalog Spanish video consistency"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-17"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "watch-page"
  - "i18n"
---

## Problem

B16 / QA603, QA624, QA626, QA612 (N33, N48b, N50b, N24a), PR #2755,
left two Spanish `vídeo` outliers because the English-copy gate rejects the
legitimate shared Spanish spelling `video`. Complete the accepted Latin
American spelling consistently while preserving the offered Arabic plural,
Jesus films translation, and Thai title-prefix fixes.

## Entry Points — Read These First

1. `apps/web/messages/es.json`: `VideoLabels.video`,
   `LanguageInventory.videoCount`, and `LanguagePickerModal.seeAllVideosInLanguage`.
2. `apps/web/src/i18n/__tests__/messages-parity.test.ts`: Spanish regression
   and exact/normalized English-copy gate.
3. `apps/web/scripts/ui-catalog-policy.mjs` and
   `apps/web/scripts/translate-ui-catalogs.mjs`: shared locale-specific copy policy
   and catalog integrity validation.
4. `docs/i18n/watch-ui-provisional-catalogs.json` and
   `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`: provenance.

## Grep These

- `vídeo|videoCount|seeAllVideosInLanguage`
- `exactCopies|normalizedCopies|validateCatalogIntegrity`
- `sourceDigestForFlatCatalog|catalogDigest`

## What To Build

- Remove all Spanish `vídeo` outliers in favor of `video`.
- Accept only the two exact shared Spanish messages at their specific keys;
  retain rejection of unrelated English strings and other locale copies.
- Replace the test pinning the accent exception with complete consistency and
  real ICU singular/plural coverage; prove the policy before changing it.
- Refresh affected provenance with local generator helpers only.

## Constraints

- Preserve current-main Spanish `Feedback` content and all offered PR changes.
- No translation/model API calls, generic copy waiver, generated GraphQL edits,
  roadmap index regeneration, or PR publication from this worker.
- Parent owns independent review, authoritative validation, and publication.

## Verification

- Focused `messages-parity`, `translate-ui-catalogs`, and
  `watch-ui-provisional-catalogs` tests; existing Thai title-prefix tests.
- `check:ui-locales`, `check:provisional-ui-catalogs`, touched formatting/lint,
  and applicable type checks.
- Compare Spanish catalog and scoped serialized message bytes before/after.
  This completion changes copy and offline policy only; no runtime loading,
  routing, hydration, or initialization changes.

## Completion Evidence

- Both Spanish outliers now use `video`; real `next-intl` formats `1 video`
  and `2 videos`. The picker retains `Ver todos los videos en {language}`.
  Spanish `Feedback` equals current main.
- Shared policy accepts only the exact Spanish `VideoLabels.video` and
  `LanguageInventory.videoCount` values. Parity, response validation, catalog
  validation, resume, and promotion use it without relaxing other copy checks.
- Proof-first run failed on the two outliers, integrity rejection, and response
  rejection. Final scoped run: 9 files, 642 tests passed, including preserved
  Arabic, Jesus films, and Thai regressions. TypeScript, package-scoped touched
  ESLint, Prettier, and both catalog drift checks passed.
- Only the Spanish catalog digest changed, using local generator helpers;
  source/model provenance remains intact. No translation API was invoked.
- Serialized Spanish catalog: 31,522 → 31,519 raw bytes, 10,577 → 10,568 gzip
  bytes. Inventory client messages: 4,718 → 4,715 raw, 1,695 → 1,685 gzip.
  This completion changes strings and offline policy, with no new render,
  hydration, loading, routing, media, or initialization work. No browser timing
  or acceptance trace is claimed.
- The offered PR commits rebased cleanly onto
  `848ce82f8d675431c83d66aef3651953d4183b8d`. Parent owns independent review,
  canonical commit/publication, and fresh CI; roadmap index intentionally left
  untouched.

## Independent Review

Correctness and a separately dispatched adversarial review found no actionable
defects on October 17. Independent offline probes checked 37 boundary cases
with 111 assertions, made no network calls, and confirmed the Spanish-only
provenance delta and preservation of main’s Spanish Feedback. The new helper
declaration is included in the final patch. Fresh CI remains required.
