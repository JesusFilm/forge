---
id: "feat-709"
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
5. `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts` — the
   provenance contract excludes `pendingTranslationPaths` before hashing. Use
   the exported `contentDigest` and `flattenCatalog` helpers from
   `apps/web/scripts/translate-ui-catalogs.mjs` on that same filtered input;
   these pending Feedback edits require no manifest digest change.
6. `apps/web/src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx`
   — registering the real Spanish test catalog also exercises Spanish SEO.

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
4. Verify Spanish provenance with the existing pending-path filter and leave
   `docs/i18n/watch-ui-provisional-catalogs.json` unchanged: all changed paths
   remain globally pending. Run the provenance and inventory-route suites as
   well as the feedback/message suites, formatting, lint, types, and
   catalog/client payload comparisons. Complete the ticket after verification.

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
- `src/i18n/__tests__/messages-parity.test.ts`,
  `src/i18n/client-messages.test.ts`,
  `src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`, and
  `src/app/[locale]/[htmlLang]/videos/[languageSlug]/page.test.tsx` under the
  Web Vitest configuration. The provenance guard stays unchanged; Spanish SEO
  must follow the requested catalog, matching the adjacent Russian control.
- Web TypeScript check, touched-file ESLint, catalog generator drift check,
  Prettier checks, `git diff --check`, and normal commit hooks.
- Compare UTF-8 and gzip sizes of the Spanish catalog and picked global client
  messages against the pre-fix commit; runtime and request graph remain intact.

## Resolution

The 103 wizard messages now use Spanish copy; 102 values changed because `Idea`
is also correct Spanish. The seven existing launcher/loading translations,
placeholders, category enums, runtime behavior, support URL, and all other
catalogs are preserved. The provenance digest remains unchanged because its
existing contract excludes globally pending Feedback paths before hashing.
Other locales retain those pending paths; a Spanish namespace test separately
prevents English copy returning to the completed Spanish wizard.

Seven new regression cases failed against the original catalog. The real
Spanish catalog drives all five steps, category prompts, validation, lookup
failures, and mocked delivery/receipt/follow-up states. The initial 537-test
selection passed but omitted two impacted suites; the CI correction below
records the expanded validation.

Picked global client messages changed by +696 UTF-8 bytes and +93 gzip bytes. No runtime imports, requests, rendering, hydration, or loading logic changed.

Independent cross-provider review read all 103 wizard messages and found no
material translation defects. Its optional grammar correction was applied.
This is not a native-speaker review. Browser preview and deployed behavior
remain with the calling workflow; no external feedback was submitted.
FGE-189 remains open for broader translation work.

## CI correction and validation learning

CI run `38689021008` exposed two missed contracts. The initial digest update
hashed every Spanish key; the existing provenance guard hashes only keys outside
`pendingTranslationPaths`. Restoring the pending-filtered digest removes the
manifest change. Do not change the guard or global pending policy to accept a
full-catalog digest.

Adding `es` to the shared test translator exposed an old English expectation in
the Spanish inventory SEO test. `page.tsx` requests `LanguageInventory` for the
selected locale, and the base Spanish catalog already contains Spanish metadata.
The adjacent Russian case confirms that requested-catalog intent. The corrected
Spanish assertion improves test fidelity without changing production behavior.

The first validation selected feedback/message tests but missed the provenance
consumer under `src/lib` and the inventory route affected by the shared mock.
Self-review reused the updater's unfiltered digest assumption instead of reading
the independent guard. For catalog edits, trace manifest consumers and shared
translator users when choosing checks; compute provenance over the guard's exact
filtered input. Include both suites alongside the original feedback/message tests.

The expanded local validation passed all 557 tests: feedback (71), catalog
parity/ICU (460), client messages (6), provenance (7), and inventory routes (13).
UI/provisional catalog generator checks, Web TypeScript, touched-file ESLint,
formatting, and diff checks also passed. Remote CI, independent review of the
complete branch diff, and browser acceptance remain with the calling workflow.

## Main integration and ID renumber

Main added `feat-708-watch-url-only-language-routing.md` (PR #2758) while this
ticket also used `feat-708`. This ticket now uses `feat-709`, the next ID after
an active-PR, local-ref, and sibling-worktree allocation check. Main's
`feat-707` and `feat-708` tickets and README rows stay unchanged.

The merge also brings in the PR #2756 phone fix (`min-w-0` on the feedback form
in `FeedbackModal.tsx`) and the URL-only routing change in `proxy.ts` and
`locale.ts`. The Spanish catalog, tests, and provenance data are unchanged.
After the merge, the 557 focused tests and 375 proxy, locale, language, and
routing tests pass, together with generator checks, ESLint, TypeScript, and
Prettier. Spanish mobile and desktop acceptance on a deployed preview stay with
the calling workflow.
