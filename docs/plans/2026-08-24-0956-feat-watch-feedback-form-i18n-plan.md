---
title: Watch Feedback Form Internationalization - Plan
type: feat
date: 2026-08-24
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Feedback Form Internationalization - Plan

## Goal Capsule

- **Objective:** The native Watch feedback form renders every user-visible string through the locale catalog system, so each of the 225 supported UI locales serves its own translated copy once its catalog carries translations. On the KTD3 fallback path this PR ships the full key structure with English values in non-English catalogs; visitor-locale rendering for those locales lands with the tracked follow-up translator run.
- **Means:** Move all hardcoded English strings in `apps/web/src/components/FeedbackModal.tsx` into the existing next-intl `Feedback` namespace (KTD1).
- **Authority:** Requirements below win on product behavior; KTDs win on mechanism; units carry only unit-local deltas.
- **Stop conditions:** Stop if research-invalidating evidence appears against KTD1, or if the translator tooling and the `pendingTranslationPaths` fallback both fail to satisfy the parity test.

---

## Product Contract

### Summary

PR #2000 replaced the embedded Google Form with a native 5-step feedback form in `apps/web/src/components/FeedbackModal.tsx`. Only the close-button aria-label uses next-intl; every other string is hardcoded English. This plan externalizes all user-visible strings into the `Feedback` namespace, renders submission errors from typed reasons instead of server-supplied English text, propagates the new keys to all 225 catalogs, and prunes the dead Google-Form-era keys.

### Problem Frame

A visitor browsing Watch in any of the 224 non-English UI locales sees a fully English feedback form. The old Google Form modal at least had a translated chrome; the native replacement regressed that. The repo's i18n infrastructure (catalogs, parity test, translator script, client namespace projection) already supports full localization — the form just doesn't use it.

### Key Decisions

- **Use the existing next-intl `Feedback` namespace for all form strings.** (session-settled: user-approved — chosen over per-locale external Google Form URLs: the form is now native code and the catalogs + parity test already enforce every-key-in-every-catalog coverage.) Governs R1.
- **Implement on latest `origin/main` (commit `637cba48`) in a dedicated worktree.** (session-settled: user-directed — chosen over the stale local main checkout: local main was 21 commits behind and predates the native form.)

### Requirements

**Localization coverage**

- R1. Every user-visible string in `FeedbackModal.tsx` renders through `useTranslations("Feedback")`: step titles/helpers, category option labels/prompts/helpers, language-area and content-scope option labels, field labels, placeholders, helper texts, validation messages, submit/nav button labels, element-picker strings, header/success/footer copy, diagnostics disclosure copy and `<dl>` term labels, aria-only strings (step progress, clear-selection, sr-only legend), and the async interaction-state strings: the language-options loading placeholder, language-list-unavailable helper, "Retry list" / "Enter manually" / "Choose from list" toggles, content-search loading/error/no-match messages, the "Media" fallback label, and the "optional" markers.
- R2. Interpolated strings use ICU variables — `Selected {role} · choose again`, `Step {step} of {count}` — so the parity test's ICU contract protects them across catalogs.
- R3. Submission failure messages render client-side with a translated message for each condition: the typed `reason` values on `FeedbackActionResult` (`invalid`, `rate_limited`, `delivery_failed`), the client-local timeout, and action rejection or an unknown/absent `reason` (generic failure message). The modal stops rendering the server's English `message` string.

**Non-localization boundary**

- R4. Persisted and wire values stay English: category/language-area/content-scope enum `value` fields, diagnostics values ("Unknown …" fallbacks included), the payload literal "Not specified", the Linear issue body, the sr-only anti-bot honeypot label "Website", and the interpolated `{role}` value in the element-picker string (the raw DOM tag/role token, matching the persisted value — no friendly-role display map in this plan).

**Catalog integrity**

- R5. Every new `Feedback.*` key exists in all 225 catalogs and `messages-parity.test.ts` passes, including its translated-copy gate — via the scoped translator run when an OpenAI key is available, otherwise via English seeding plus `pendingTranslationPaths` listing (KTD3).
- R6. Dead Google-Form-era keys (`title`, `description`, `openInNewTab`, `loadingGoogleForm`, `iframeTitle`, `openFormShort` — each verified consumer-free first) are removed from `en.json` and all 224 non-English catalogs.

**Regression safety**

- R7. Existing `FeedbackLauncher.test.tsx` behavior tests keep passing; a full form walk-through asserts no raw `Feedback.*` key text leaks into the rendered output (the vitest next-intl mock renders `Namespace.key` for missing keys, making leakage assertable).

### Scope Boundaries

- **Out of scope:** localizing the Linear issue body or any operator-facing diagnostics; changing form behavior, step flow, or the submission contract beyond dropping `message` consumption; adding or removing locales.
- **Deferred to follow-up work:** human review of machine-translated `Feedback.*` copy in low-resource locales (repo posture: provisional catalogs stay English by policy — see `docs/i18n/watch-ui-provisional-catalogs.json`); if U4 ships the `pendingTranslationPaths` fallback, a follow-up PR runs the translator and empties the list (precedent: commit `bb951628`).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Extend the existing `Feedback` namespace rather than creating a new one.** (session-settled: user-approved — chosen over per-locale external form URLs: native code + existing enforcement.) The namespace is already in `GLOBAL_CLIENT_MESSAGE_NAMESPACES` (`apps/web/src/i18n/client-messages.ts`) and `FeedbackModal` already calls `useTranslations("Feedback")`, so no client-projection change is needed. Governs R1 (catalog propagation of the keys is KTD3's).
- KTD2. **Translate submission errors on the client, keyed by the typed `reason`.** The server action (`apps/web/src/lib/feedback-action-core.ts`) has no locale context and returns English `message` strings the modal currently renders verbatim. `FeedbackActionResult` already carries `reason` (`invalid | rate_limited | delivery_failed`), so the client maps reason → translated key and ignores `message`; no server change is required. Rejected: threading the locale into the server action — larger contract change for no benefit. Owns R3.
- KTD3. **Catalog propagation: scoped translator first, `pendingTranslationPaths` fallback.** Primary path: `pnpm --filter @forge/web translate:ui-catalogs --keys <new Feedback.* paths>` (requires `OPENAI_API_KEY`/`API_OPENAI` — the script throws `MISSING_OPENAI_API_KEY` before any work and has no keyless mode). Fallback when no key is available: a one-off seeding script (same vehicle as U3's removal script) copies the new English `Feedback.*` values from `en.json` verbatim into all 224 non-English catalogs, and every new path is listed under `pendingTranslationPaths` in `apps/web/scripts/ui-translation-policy.json` (repo precedent: the WatchUnavailableLanguage arc), which satisfies the parity test's translated-copy gate; expect a `translate-ui-catalogs.test.mjs` ownership-fixture touch when the policy file changes. Provenance-digest interaction: U3's out-of-band key removals change the source digest recorded in `docs/i18n/watch-ui-provisional-catalogs.json`, so a later scoped `--keys --promote` run would fail `SCOPED_PROMOTION_SOURCE_DRIFT` — the follow-up translator run must be full/unscoped, or the manifest's provenance digests must be refreshed after the removal sweep. Owns R5.
- KTD4. **Diagnostics `<dl>` term labels get an explicit key→label map; values stay raw.** The current `key.replace(/([A-Z])/g, " $1")` derivation cannot localize; a map typed `Record<keyof FeedbackDiagnostics, string>` (fields: `browser`, `operatingSystem`, `device`, `viewport`, `timeZone`, `appVersion` — so an unmapped future field is a compile error) renders translated `<dt>` labels while `<dd>` values remain the English diagnostics persisted to Linear (R4).
- KTD5. **Keep `Select language` as a `Feedback`-namespace key rather than reusing `LanguageCombobox.selectLanguage`.** Cross-namespace reuse couples two components' copy lifecycles; the repo convention is component-per-namespace. Strings rendered _by_ the embedded `LanguageCombobox` component itself are already translated and untouched.

### Assumptions

- The implementation environment may lack `OPENAI_API_KEY`; KTD3's fallback path is the expected default in this pipeline run, with the translator run deferred to follow-up.
- The stale Google-Form-era keys have no consumers; U3 re-verifies with the namespace-aware check before deleting. Any key still consumed by `FeedbackLauncher.tsx` (which is already fully translated: `openForm`, `label`, `couldNotLoad`, `loadingForm`, `retry`, `cancel`, `closeForm`) is kept; `openFormShort` was verified consumer-free and is removed per R6.
- Existing English copy is kept byte-identical when moved into `en.json`, so `FeedbackLauncher.test.tsx` literal assertions keep passing through the vitest global next-intl mock (`apps/web/vitest.setup.ts` builds a real `createTranslator` over `messages/en.json`).

### Sources

- String inventory and contract analysis: `apps/web/src/components/FeedbackModal.tsx`, `apps/web/src/lib/feedback.ts`, `apps/web/src/lib/feedback-action-core.ts`.
- Prior instance of this exact task shape: `docs/solutions/ui-bugs/watch-collection-download-raw-next-intl-keys-missing-client-namespace.md` (namespace projection + scoped `--keys` repair workflow).
- Machine-translation quality posture: `docs/solutions/ui-bugs/machine-translated-ui-catalog-wrong-language-validation-gap.md` (provisional locales stay English; never hand-promote unverified low-resource output).
- Catalog workflow precedent: commit `bb951628` (translator run emptying `pendingTranslationPaths`).

---

## Implementation Units

### U1. Externalize FeedbackModal strings into the Feedback namespace

- **Goal:** Every hardcoded user-visible string in `FeedbackModal.tsx` renders via `t(...)` from the `Feedback` namespace.
- **Requirements:** R1, R2, R4 (boundary), KTD1, KTD4, KTD5.
- **Dependencies:** none.
- **Files:** `apps/web/src/components/FeedbackModal.tsx`, `apps/web/messages/en.json`, `apps/web/src/components/FeedbackLauncher.test.tsx` (only if selectors need adjusting).
- **Approach:**
  1. Add all new keys under `Feedback` in `en.json`, grouped by sub-object (e.g. `steps`, `categories`, `languageAreas`, `contentScopes`, `fields`, `validation`, `picker`, `success`, `diagnostics`) with copy byte-identical to today's English — including the existing typographic apostrophes (U+2019); a straight ASCII apostrophe is an ICU escape character and would silently alter rendered output.
  2. Convert the module-level `STEP_COPY` / `CATEGORY_OPTIONS` / `LANGUAGE_AREA_OPTIONS` / `CONTENT_SCOPE_OPTIONS` constants: keep the persisted `value` fields as literals and resolve display fields through `t()` at render time (hook-scope memo or inline), since `useTranslations` is component-scoped.
  3. Use ICU for `Selected {role} · choose again` and `Step {step} of {count}`.
  4. Replace the diagnostics `<dt>` derivation with the KTD4 key→label map; leave `<dd>` values raw.
  5. Leave untouched: honeypot label "Website", persisted "Not specified", diagnostics values, enum values.
- **Patterns to follow:** existing `Feedback` launcher keys and other component namespaces in `en.json`; ICU usage elsewhere in the catalogs; `useTranslations` usage already in this file (`t("closeForm")`).
- **Test scenarios:**
  - Happy path: opening the modal renders the translated step-1 title/helper and all four category labels (assert current English strings still render via the en catalog).
  - Full walk-through to step 5 renders no text matching `/Feedback\./` anywhere (missing-key tripwire, Covers R7's mechanism).
  - Element-picker selected state renders the ICU-interpolated role string.
  - Step progress aria-label interpolates step and count.
  - Validation errors (empty category, short message, missing name, malformed email) render the translated messages.
  - Async states: step 2 with the language-options loader in its error state renders the translated unavailable-helper and "Retry list" / "Enter manually" strings; the content-search surface in loading, error, and no-match states renders its translated messages (mock the loaders).
- **Verification:** `FeedbackLauncher.test.tsx` suite green; component compiles with no remaining user-visible string literals (manual scan of the diff).

### U2. Reason-keyed submission error rendering

- **Goal:** Submission failures render translated messages derived from the typed `reason`; the server's English `message` is no longer rendered.
- **Requirements:** R3, KTD2.
- **Dependencies:** U1 (keys land in the same namespace groups).
- **Files:** `apps/web/src/components/FeedbackModal.tsx`, `apps/web/messages/en.json`, `apps/web/src/components/FeedbackLauncher.test.tsx`.
- **Approach:** map `result.reason` → `t("errors.invalid" | "errors.rateLimited" | "errors.deliveryFailed")`; keep the client-local timeout and catch-fallback messages as their own keys; do not change `feedback-action-core.ts`'s return shape (its `message` simply stops being consumed).
- **Test scenarios:**
  - Error path: mocked action returning `reason: "rate_limited"` renders the rate-limit message.
  - Error path: `reason: "invalid"` and `reason: "delivery_failed"` render their messages.
  - Error path: action rejection (thrown) renders the generic failure message.
  - Edge: an unknown/absent `reason` falls back to the generic failure message, never `undefined` or the raw server string.
- **Verification:** new error-path tests green; grep confirms `result.message` is no longer read in the modal.

### U3. Prune dead Google-Form-era Feedback keys

- **Goal:** Consumer-free legacy keys are removed from `en.json` and all 224 non-English catalogs.
- **Requirements:** R6.
- **Dependencies:** U1 (final key set must be settled first so one sweep suffices).
- **Files:** `apps/web/messages/*.json` (all 225).
- **Approach:** namespace-aware consumer verification — enumerate the files binding the `Feedback` namespace (`grep -rn 'useTranslations("Feedback")' apps/web/src`, plus any `getTranslations("Feedback")`; currently `FeedbackLauncher.tsx` and `FeedbackModal.tsx`) and check each candidate key (`title`, `description`, `openInNewTab`, `loadingGoogleForm`, `iframeTitle`, `openFormShort`) only against `t(...)` calls in those files — a repo-wide `t("<key>")` grep false-positives on generic key names in other namespaces (e.g. `BetaTesterModal` calls `t("title")` and `t("iframeTitle")`). Delete only verified-dead keys, via a one-off script across all catalogs (manual editing of 225 files is error-prone; the translator script does not handle removals).
- **Test expectation:** none — covered by the parity test (a key removed from `en.json` but left in a non-English catalog fails its `unexpected`-keys gate, and vice versa).
- **Verification:** `messages-parity.test.ts` green; the namespace-aware check shows zero consumers of removed keys within `Feedback`-bound files.

### U4. Propagate new keys to all 224 non-English catalogs

- **Goal:** Every new `Feedback.*` key exists in every catalog and the parity test's translated-copy gate passes.
- **Requirements:** R5, KTD3.
- **Dependencies:** U1, U2, U3 (final `en.json` key set).
- **Files:** `apps/web/messages/*.json`, `apps/web/scripts/ui-translation-policy.json` (fallback path only), `apps/web/scripts/translate-ui-catalogs.test.mjs` (fixture, fallback path only).
- **Approach:** per KTD3 — attempt the scoped translator run when an OpenAI key is present in the environment; otherwise seed English via the one-off seeding script (KTD3 fallback — `translate-ui-catalogs.mjs` cannot run keyless) and list every new path under `pendingTranslationPaths`, updating the ownership fixture. Never hand-write translations; never promote provisional locales. On the fallback path, record the follow-up translator run as a tracked deliverable (roadmap ticket or PR checklist item), noting the KTD3 provenance-digest constraint (full/unscoped run, or refresh the manifest digests).
- **Test expectation:** none — the parity test and `translate-ui-catalogs.test.mjs` are the coverage.
- **Verification:** `messages-parity.test.ts` green across all 225 catalogs; `check:ui-locales` unchanged/green.

### U5. Regression guard for the translated form

- **Goal:** The suite pins the new i18n behavior so a future hardcoded-string regression or missing key fails tests.
- **Requirements:** R7.
- **Dependencies:** U1, U2.
- **Files:** `apps/web/src/components/FeedbackLauncher.test.tsx`.
- **Approach:** add the no-raw-key-leakage walk-through (U1 scenario) as a durable test; keep existing literal assertions (they now prove the en-catalog path end-to-end through the global next-intl mock); pin one reason-keyed error rendering (U2) as the discriminating fixture for the reason→message map.
- **Test scenarios:**
  - Full 5-step walk-through with submission: no rendered text matches `/\bFeedback\.[A-Za-z]/`.
  - The reason-map test uses a reason whose translated message differs from the server `message` string, proving the server string is not what renders.
- **Verification:** `pnpm --filter @forge/web test` green.

---

## Verification Contract

| Check               | Command (from repo root)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Proves                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Unit + parity tests | `pnpm --filter @forge/web test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | R1–R3, R5–R7 (includes `messages-parity.test.ts`, launcher suite, translator fixture) |
| Parity test alone   | `cd apps/web && pnpm run generate:ui-locales && npx vitest run src/i18n/__tests__/messages-parity.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | R5, R6                                                                                |
| Modal suite alone   | `cd apps/web && npx vitest run src/components/FeedbackLauncher.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | R1, R3, R7                                                                            |
| Types               | `pnpm --filter @forge/web typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | component conversion sound                                                            |
| Lint                | `pnpm --filter @forge/web lint`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | includes `check:ui-locales`                                                           |
| Browser smoke       | build-and-start (`next build` + `next start`, not dev), open the feedback modal on one long-string non-English Watch locale route (German, slug-form URL) and one RTL locale. On the translator path verify translated copy; on the KTD3 fallback path verify the English fallback copy renders (translated rendering lands with the follow-up run). Either path: no raw `Feedback.*` keys, no clipped or overflowing button/tile labels across all 5 steps, RTL document direction on the modal content with the `{role}` interpolation and step indicator rendering in order; use `data-open`/`data-closed` dialog attributes, not element presence | R1 end-to-end                                                                         |

Frontend page-load note: this change adds catalog keys to an already client-shipped namespace and converts literals to `t()` calls — no new network requests, media, or hydration surfaces. Catalog payload grows by the new `Feedback` keys; confirm the client-messages payload delta is the only load-relevant change and note its size in the PR.

---

## Definition of Done

- All five units implemented and their per-unit verifications pass.
- Full `pnpm --filter @forge/web test`, `typecheck`, and `lint` green.
- No user-visible English literal remains in `FeedbackModal.tsx` outside the R4 non-localization boundary.
- If U4 shipped the fallback path: `pendingTranslationPaths` entries are listed and the follow-up translator-run task is recorded in the PR description.
- No abandoned experimental code in the diff.
