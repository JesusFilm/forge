---
id: feat-155
title: Watch UI official-language catalog rollout
status: "complete"
priority: high
area: platform
tags:
  - web
  - watch-page
  - i18n
  - localization
depends_on:
  - feat-150
  - feat-151
blocks: []
---

## Problem

Watch content can render in a viewer's language while app-owned chrome falls
back to English when no matching UI catalog exists. The visible Bangla watch
page issue shows this clearly: content metadata is Bangla, but labels such as
Episode, Download, and Play with Sound remain English.

The broader rollout should be derived from the supplied GA4 country report, but
that report is country-based rather than language-based. Planning must derive
official and national languages from an external public authority before adding
or sequencing UI catalogs.

## Entry Points

- `docs/brainstorms/2026-06-02-watch-ui-official-language-catalogs-requirements.md`
- `docs/plans/2026-06-02-001-feat-watch-ui-official-language-catalogs-plan.md`
- `apps/web/messages/*.json`
- `apps/web/src/i18n/generated-ui-locales.ts`
- `apps/web/scripts/generate-ui-locales.mjs`
- `apps/web/src/lib/locale.ts`

## What To Build

Implement the first PR-sized rollout slice:

- Add an auditable official/national-language inventory derived from the GA4
  country list and Unicode CLDR territory language data.
- Add a real Bangla UI catalog so Bangla watch routes can render localized app
  chrome through the existing generated-catalog system.
- Preserve public watch URL shape and the existing separation between UI
  catalog language, public audio slug, and content metadata language.
- Record languages that require follow-up catalog work or mapping decisions
  instead of silently skipping them.

## Constraints

- Do not change public watch URL shape.
- Do not conflate UI catalog availability with audio/content availability.
- Do not add English placeholder catalogs for languages that still require
  translation review.
- Keep UI catalog membership generated from `apps/web/messages/*.json`.
- Keep the rollout PR small enough to validate honestly; broad catalog batches
  can follow from the generated inventory.

## Verification

- `pnpm --filter @forge/web check:ui-locales`
- `pnpm --filter @forge/web test -- src/i18n/__tests__/messages-parity.test.ts src/lib/locale.test.ts src/proxy.test.ts`
- `pnpm --filter @forge/web typecheck`
- Helium/browser smoke for a Bangla watch URL showing localized chrome.
