---
id: "feat-672"
title: "Verify localized Watch skip-link copy"
owner: "vlad"
priority: "P2"
status: "not-started"
start_date: "2026-10-09"
duration: 2
depends_on:
  - "feat-631"
blocks: []
tags:
  - "web"
  - "i18n"
  - "accessibility"
---

## Problem

FGE-204 adds `WatchAccessibility.skipToMainContent` to all Watch catalogs. The
existing PR supplies candidate localized values, while 15 non-provisional
catalogs retain English. No verified translation run produced these values.
The narrowly declared pending path preserves provenance for the completed
portion of each catalog without claiming this copy is translated.

## Entry Points — Read These First

1. `apps/web/src/app/[locale]/[htmlLang]/layout.tsx`: the first body link reads the server-only accessibility label.
2. `apps/web/scripts/ui-translation-policy.json`: `pendingTranslationPaths` contains the new leaf.
3. `apps/web/scripts/openai-catalog-translator.mjs`: verified surface context and assistive-technology role.
4. `apps/web/scripts/translate-ui-catalogs.mjs`: sanctioned scoped translation and provenance writer.
5. `docs/solutions/workflow-issues/merge-pending-catalog-fallbacks-with-localized-provenance.md`: pending-copy provenance contract.
6. `docs/i18n/watch-ui-provisional-catalogs.json`: catalog ownership, provisional locales, source and catalog digests.

## Grep These

- `WatchAccessibility.skipToMainContent`
- `pendingTranslationPaths`
- `scopeMessagePaths` and `localeProvenance`

## What To Build

Verify or replace this single message using the approved contextual translation
workflow. Resolve the 15 remaining English values without inventing low-resource
language phrases. Record the actual method and model; preserve existing authored
translations and the two explicitly English-seeded provisional catalogs. Remove
only this path from pending policy when its translated portion is complete and
refresh the associated source/catalog digests through the sanctioned workflow.

## Constraints

Do not relax translation gates, forge provenance, or label candidate values as
reviewed. Keep the message server-only; no added client payload. Do not change
keyboard target ownership or landmarks.

## Verification

Run scoped translator tests, `src/i18n/__tests__/messages-parity.test.ts`, and
`src/lib/__tests__/watch-ui-provisional-catalogs.test.ts` with Node 24 and capped
workers. Check representative LTR and RTL skip labels and provenance digests.
Confirm client message serialization still excludes `WatchAccessibility`.
