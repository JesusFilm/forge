---
date: 2026-07-16
type: fix
scope: web-watch-language-modal-i18n
status: completed
roadmap: docs/roadmap/content-discovery/feat-264-watch-language-modal-link-localization.md
owner: codex
---

# fix: Localize Watch language modal catalog links

## Summary

Route every language-modal-owned label through its existing `next-intl`
namespace so localized Watch pages do not mix translated chrome with English
literals. Preserve the bilingual language selector and intentionally
multilingual tooltips while localizing the new catalog links, their accessible
names, and the error/pending-state labels.

## Problem Frame

Feat-256 added direct catalog navigation to `LanguagePickerModal`, but the new
visible labels and selected-language `aria-label` were written as literal
English JSX. The current Russian page correctly resolves `ru.json`, which is
why the older labels render in Russian while only the new links remain in
English. The same component also contains English-only retry, subtitle
unavailable, and pending-navigation labels in less common states.

This is a component-copy regression, not a locale-routing or catalog-selection
failure. The fix should use the modal's existing translator and current catalog
ownership rules rather than changing the public URL or locale pipeline.

## Requirements

- R1. The all-languages link renders from the active `LanguagePickerModal` catalog.
- R2. The selected-language inventory link uses one localized template for visible and accessible copy.
- R3. The template interpolates the selected language's native display name when available, falling back to the existing English-primary name.
- R4. Language-loading retry, subtitle-unavailable, and pending-navigation copy is localized through the modal namespace.
- R5. Every shipped catalog contains the new keys; Russian receives contextual regression copy, every other non-provisional catalog receives locale-specific copy that is not an exact English-source value, and catalogs recorded as provisional remain exact English-source clones.
- R6. Existing routes, link placement, draft selection updates, focus treatment, mobile layout, bilingual selector rows, and multilingual tooltip behavior remain unchanged.

## Scope Boundaries

In scope:

- Modal-owned catalog-link, retry, unavailable, and pending-navigation copy exposed by the feat-256 surface.
- Catalog updates required by structural parity and authored/provisional ownership.
- Focused component, catalog, and browser regression proof.

Out of scope:

- Locale routing, public audio-language slug behavior, or catalog inventory policy.
- Translating language names supplied by content data; the selector intentionally keeps English-primary and native-name rows.
- Replacing the five-language icon/action tooltips, which are intentionally multilingual accessibility affordances.
- Completing the broader provisional-catalog translation program.

## Key Technical Decisions

- Keep all new strings in `LanguagePickerModal` because the copy belongs to one modal and the component already owns that translator.
- Reuse one ICU-style inventory-link template for both visible text and `aria-label` so assistive copy cannot drift from the rendered action.
- Interpolate `nativeName ?? name` for the destination language, bounded by Unicode first-strong-isolate/pop-directional-isolate marks. This removes the remaining English language-name fragment on Russian pages and keeps mixed-script names ordered inside LTR or RTL templates without changing the bilingual selector contract.
- Follow `docs/i18n/watch-ui-provisional-catalogs.json`: locale-specific translations for non-provisional catalogs, exact English cloning for locales explicitly marked provisional. Engineering acceptance proves catalog use, key/placeholder integrity, and absence of English leakage; it does not certify native-speaker grammar outside the Russian regression target.
- Add localized-rendering coverage rather than relying only on English text assertions, because the introducing tests passed while the JSX still bypassed `next-intl`.

## Implementation Units

### U1. Move modal-owned literals into the message catalog

**Goal:** Make the catalog links and remaining modal-owned state copy resolve through the active locale.

**Requirements:** R1, R2, R3, R4, R6.

**Dependencies:** None.

**Files:**

- `apps/web/src/components/watch/LanguagePickerModal.tsx`
- `apps/web/src/components/watch/__tests__/LanguagePickerModal.test.tsx`

**Approach:** Add translator lookups for the all-languages label, selected-language inventory template, retry label/title, subtitle-unavailable chip, and pending-navigation label. Derive the inventory-link interpolation value from the selected option's native display name with the existing primary name as fallback, wrapping that value in Unicode bidi-isolation marks before formatting the visible/accessibility string. Keep the current route builders and layout untouched. Install a file-local, resettable `next-intl` mock in the component test so individual cases can use the English or Russian namespace without changing the repository-wide English test mock.

**Patterns to follow:** Existing `t("languageHeading")`, `t("close")`, and `t("apply")` usage in `LanguagePickerModal`; route and draft-selection assertions in the same test file.

**Test scenarios:**

1. Given English messages and the English draft language, both catalog links and the inventory-link accessible name render the English catalog values and keep their existing hrefs.
2. Given Russian messages and a Russian option with native name `русский`, the all-languages label, inventory-link visible text, and accessible name render Russian copy without the English literals or English `Russian` fragment.
3. Given a selected option without a native name, the inventory-link template interpolates its existing primary display name and remains navigable.
4. Given language options fail to load under a non-English locale, the retry button's accessible name and title use the active catalog.
5. Given a subtitle is unavailable or an audio-language navigation is pending, the chip and disabled Apply label use the active catalog.
6. Given an RTL UI template interpolates a selected language name written in an LTR script, isolation marks preserve the surrounding template order and the computed accessible name contains the correct words.

**Verification:** Component tests prove localized rendering, selected-language updates, accessible names, and unchanged routes/layout.

### U2. Extend catalog coverage under the existing ownership policy

**Goal:** Add the modal keys without creating new mixed-language gaps in authored locales or breaking provisional catalog invariants.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** U1.

**Files:**

- `apps/web/messages/en.json`
- `apps/web/messages/*.json`
- `apps/web/scripts/generate-provisional-ui-catalogs.mjs`
- `apps/web/src/i18n/__tests__/messages-parity.test.ts`
- `apps/web/src/lib/__tests__/watch-ui-provisional-catalogs.test.ts`
- `docs/i18n/watch-ui-provisional-catalogs.json`

**Approach:** Define the source messages in English. Treat `manifest.provisionalLocales` as the exact clone set; every other shipped non-English catalog, including `existingNonInventoryLocales`, receives contextual copy. Extend generator write mode to overwrite only manifest-listed provisional files from English while leaving authored/non-inventory catalogs untouched; keep check mode read-only and strict. Preserve ICU variables exactly across locales and strengthen data-driven catalog coverage without changing catalog classification.

**Patterns to follow:** Structural parity in `messages-parity.test.ts`, exact provisional-source matching in `watch-ui-provisional-catalogs.test.ts`, and the generator policy in `generate-provisional-ui-catalogs.mjs`.

**Test scenarios:**

1. Every catalog contains the new modal keys.
2. Every localized inventory-link template preserves the `{language}` variable.
3. Russian values are contextual Russian copy rather than exact English-source copies.
4. Every catalog listed as provisional remains byte-equivalent to the updated English catalog.
5. Generator write mode refreshes existing provisional catalogs but does not modify an authored or existing-non-inventory catalog.
6. Every non-English, non-provisional catalog has an explicit locale-specific value for each new key, differs from the English source where the string is translatable, and preserves the source placeholder set.

**Verification:** Catalog parity, ICU placeholder checks, provisional-catalog validation, typecheck, and lint all pass.

### U3. Prove the localized modal on representative viewports

**Goal:** Confirm the user-visible Russian regression is fixed without mobile layout or accessibility regressions.

**Requirements:** R1, R2, R3, R4, R6.

**Dependencies:** U1, U2.

**Files:**

- `docs/roadmap/content-discovery/feat-264-watch-language-modal-link-localization.md`

**Approach:** Open a Russian Watch page, activate the language modal, and inspect both catalog links in Mobile Safari/WebKit at 390x844 and in a desktop browser. Also stress the narrow layout with the longest shipped localized link template and a long native language name. Verify localized visible text and accessible names, correct public-language hrefs, bidi ordering, acceptable wrapping, no modal/document horizontal overflow, and no `MISSING_MESSAGE` errors. Record the exact route, browser engine, viewport, screenshots, and completion evidence in the roadmap ticket. Less-common retry/unavailable/pending states are verified in the component harness rather than claimed as live-route browser coverage.

**Patterns to follow:** Browser proof targets in feat-256 and `docs/solutions/design-patterns/watch-language-player-chrome-layout-20260609.md`.

**Test scenarios:**

1. On a mobile Russian route, the sheet contains no English catalog-link copy and does not overflow horizontally.
2. On a desktop Russian route, both localized links remain keyboard focusable and route to the language index and Russian video inventory.
3. Opening the sheet produces no missing-message or console errors.
4. A narrow WebKit stress case with long localized copy and a long native name has no clipped controls or horizontal overflow.

**Verification:** Mobile Safari/WebKit and desktop screenshots plus DOM/accessibility checks confirm localized copy, bidi ordering, link targets, focusability, and responsive layout.

## Risks & Dependencies

- Non-Russian authored catalog copy may need native-speaker refinement. Keep phrasing contextual and preserve placeholders, enforce no exact English leakage, and treat Russian as the linguistically reviewed regression target for browser proof; broader native-speaker certification is not claimed by this fix.
- The selected language can differ from the UI locale. Using its native name makes the destination recognizable across UI locales and avoids introducing a second language-name translation system.
- Updating the English source requires regenerating all provisional catalogs. The existing generator and exact-clone checks prevent partial drift.

## Acceptance Examples

- Given `/watch/.../russian.html` resolves the Russian UI catalog, when the language sheet opens, then the new catalog actions render Russian copy alongside `Язык`, `Субтитры`, `Закрыть`, and `Применить`.
- Given Russian is selected, when the inventory action renders, then its visible and accessible text use the Russian template and the native language name while its href remains `/watch/russian.html/videos`.
- Given a provisional UI locale, when the new keys are added, then the catalog still matches the updated English source exactly and passes the existing ownership gate.

## Assumptions

- The user is reporting the current feat-256 catalog-link regression rather than requesting a redesign of the language sheet.
- The broader machine-translation completion work is separate; this fix follows the catalog classifications currently committed on `main`.
