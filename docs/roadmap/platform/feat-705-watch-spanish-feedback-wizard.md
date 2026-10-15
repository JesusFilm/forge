---
id: "feat-705"
title: "Localize the Watch feedback wizard in Spanish"
owner: "vlad"
priority: "P1"
status: "complete"
start_date: "2026-10-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "web"
  - "i18n"
  - "feedback"
---

## Problem

The Spanish Watch feedback launcher is translated, but its native five-step
composer reads 103 English strings from `apps/web/messages/es.json`. Spanish
dialects share this catalog. Related: FGE-189, which remains open for broader
namespace and locale coverage. PR #2742 explicitly excludes `Feedback.*`.

## Entry Points — Read These First

1. `apps/web/messages/es.json` — `Feedback` copy, including validation, delivery
   errors, diagnostics consent, and receipt follow-up.
2. `apps/web/src/components/FeedbackModal.tsx` — `useTranslations("Feedback")`
   and the five steps; category values and diagnostics behavior stay unchanged.
3. `apps/web/src/components/FeedbackLauncher.test.tsx` and
   `apps/web/vitest.setup.ts` — existing interactive flow and real catalog mocks.
4. `apps/web/src/i18n/__tests__/messages-parity.test.ts` — structural parity,
   placeholder checks, and translated-copy enforcement.
5. `apps/web/scripts/translate-ui-catalogs.mjs` — exported `contentDigest` and
   `flattenCatalog`; refresh only the Spanish digest in
   `docs/i18n/watch-ui-provisional-catalogs.json` without invoking an API.

## Grep These

- `Feedback`
- `pendingTranslationPaths`
- `catalogDigest`
- `feedback-step-`

## What To Build

1. Add a real Spanish regression in the existing feedback test, traverse all
   five steps with mocked actions, and record failure against the English copy.
2. Translate only the 103 pending Spanish wizard strings. Preserve the seven
   existing launcher translations and ICU placeholders.
3. Protect the completed Spanish namespace in the existing catalog test while
   retaining pending paths required by other locales. Spanish `Idea` is also
   the correct English spelling and is the sole intentional source match.
4. Refresh the Spanish digest with the existing digest helper; verify the
   focused tests, formatting, lint, types, and catalog/client payload byte and
   gzip deltas. Complete the ticket after local verification.

## Constraints

- No English or other-locale edits; no enum, runtime, routing, import, loading,
  analytics, support URL, or submission changes.
- Preserve diagnostics privacy meaning and optional name/email behavior.
- No external feedback submission. Browser preview and independent language
  review belong to the calling workflow before publication.
- Do not close FGE-189 or broaden PR #2742.

## Verification

- Existing `FeedbackLauncher.test.tsx`, including real Spanish five-step flow,
  category prompts, validation, and safely mocked delivery/follow-up states.
- `src/i18n/__tests__/messages-parity.test.ts` and
  `src/i18n/client-messages.test.ts` under the Web Vitest configuration.
- Web TypeScript check, touched-file ESLint, catalog generator drift check,
  Prettier checks, `git diff --check`, and normal commit hooks.
- Compare UTF-8 and gzip sizes of the Spanish catalog and picked global client
  messages against the pre-fix commit; runtime and request graph remain intact.

## Resolution

The 103 wizard messages now use Spanish copy; 102 values changed because `Idea`
is also correct Spanish. The seven existing launcher/loading translations,
placeholders, category enums, runtime behavior, support URL, and all other
catalogs are preserved. The Spanish digest was refreshed with the existing
`contentDigest(flattenCatalog(...))` helper. Other locales retain their global
pending paths; a Spanish namespace test now prevents English copy returning.

Seven new regression cases failed against the original catalog, then all 537
focused tests passed after translation, including the existing English tests.
The real Spanish catalog drives all five steps, category prompts, validation,
lookup failures, and mocked delivery/receipt/follow-up states. Web TypeScript,
touched-file ESLint, UI catalog drift, and formatting checks passed.

Picked global client messages changed by +696 UTF-8 bytes and +93 gzip bytes. No runtime imports, requests, rendering, hydration, or loading logic changed.

Independent cross-provider review read all 103 wizard messages and found no
material translation defects. Its optional grammar correction was applied.
This is not a native-speaker review. Browser preview and deployed behavior
remain with the calling workflow; no external feedback was submitted.
FGE-189 remains open for broader translation work.
