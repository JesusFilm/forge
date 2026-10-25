---
title: "fix: Prevent false language prompts for English Watch searches"
type: fix
status: active
date: 2026-07-24
origin: docs/brainstorms/2026-06-19-watch-multilingual-semantic-search-requirements.md
---

# fix: Prevent false language prompts for English Watch searches

## Summary

Keep short, ordinary English Watch searches in the selected English language
instead of allowing TinyLD to block them behind a false foreign-language
confirmation. While a genuine language confirmation is pending, hide every
result-state artifact from the previous query so viewers cannot mistake stale
cards, pagination, errors, or empty states for the text currently in the input.

## Problem Frame

Production currently reproduces both halves of Linear FGE-4. With English
selected, searching `Bible Project` loads BibleProject cards. Replacing that
query with `prodigal son` shows an `Estonian detected` confirmation over those
same cards; replacing it with `resur` shows `French detected` over the same
cards.

The detector is behaving confidently but incorrectly. TinyLD 1.3.4 reports
`prodigal son` as Estonian with no runner-up and reports `resur` as French with
enough score separation to pass the current "clear signal" branch. Raising a
single confidence threshold therefore cannot make the reported ticket corpus
safe. The selected English language must participate as a prior for short,
unaccented Latin-script text, while explicit script hints and distinctive
Latin marks remain available for genuinely multilingual searches.

The overlay already pauses search dispatch while a language confirmation is
pending, but it continues rendering the last completed search state. This fix
must gate that presentation state without absorbing FGE-22's broader query
invalidation, pagination race, and analytics work or FGE-23's production-wide
detector calibration program.

## Requirements

- FGE4-R1. With English selected, `prodigal son`, `resur`, `Bible Project`,
  `Bible stories`, `Jesus Bible stories`, `kids bible videos`, `christmas
story`, `faith`, `grace`, `salvation`, and `resurrection` do not trigger a
  foreign-language confirmation.
- FGE4-R2. The English prior applies only to short, unaccented Latin-script queries;
  explicit non-Latin script hints and sufficiently distinctive or longer
  multilingual queries retain their current detection path.
- FGE4-R3. A pending language confirmation renders no cards, load-more control,
  loading skeleton, prior error, or prior no-results state from the preceding
  query.
- FGE4-R4. Accepting a genuine confirmation or choosing a language through the
  existing manual `LanguageCombobox` keeps the current search-dispatch
  behavior; this change does not add a new decline interaction or redesign the
  confirmation workflow.
- FGE4-R5. Regression coverage combines deterministic detector tests, real TinyLD
  corpus tests, and rendered overlay tests for the stale presentation states.
- FGE4-R6. The change remains independently mergeable from current `origin/main`
  and does not copy FGE-1's Spanish-variant identity work.

## Assumptions

- The selected English language is the public slug `english`; the detector's
  existing language-option normalization remains the source of truth for
  matching inferred TinyLD codes to public languages.
- Ambiguous unaccented Latin text has insufficient detection evidence until it
  contains at least four language tokens and at least 20 letters. Both
  thresholds will be named detector constants and tested at their boundaries.
- A Latin query containing a Unicode combining mark after canonical
  decomposition is evidence that the English prior should not suppress
  detection, even when the query is short. This must cover the full Latin
  repertoire rather than the existing limited character ranges.
- The existing blocking confirmation remains the intended interaction for this
  fix. Making low-confidence detections non-blocking is part of FGE-23's broader
  calibration scope.
- FGE-22 owns generic query-state invalidation and late-response handling. This
  fix only prevents completed presentation state from rendering while the
  current confirmation is pending.

## Key Technical Decisions

- **Use a selected-English prior instead of another global score bump:** The
  exact `prodigal son` failure is TinyLD's top result with no runner-up, so
  score or margin tuning alone cannot address the ticket without arbitrary
  global side effects.
- **Treat short, unaccented Latin text as ambiguous under selected English:**
  TinyLD's one- and two-token guesses are demonstrably overconfident, including
  a score of 1 for `prodigal son`. Requiring at least four language tokens and
  20 letters before accepting an unaccented Latin mismatch makes the selected
  language authoritative until there is enough text to make a useful guess.
  Script detection remains authoritative for Arabic, Han, Kana, Hangul, and
  Devanagari, while canonically decomposed Latin diacritics and longer text
  retain the existing TinyLD confidence logic.
- **Gate presentation at the overlay render boundary:** The confirmation
  suggestion is already the authoritative reason search dispatch is paused.
  Marking the existing localized confirmation content as a polite status and
  using that state to suppress every result branch prevents stale semantics
  without untranslated copy or a second query lifecycle.
- **Test both policy and dependency reality:** Mocked detector tests make the
  selected-language rule deterministic, while the TinyLD-backed corpus locks
  the real dependency behavior that produced FGE-4. The real corpus includes
  retained-English short inputs and retained-foreign longer or distinctively
  marked inputs.
- **Stay independent of open overlapping work:** Do not add same-primary
  language-variant rules, generic query invalidation, or new analytics. Those
  belong to FGE-1, FGE-22, and FGE-23 respectively.

## Scope Boundaries

- Do not change Admin, GraphQL contracts, generated types, embeddings, or
  search ranking.
- Do not implement broad Latin-script threshold calibration or production
  language-detection metrics.
- Do not add Spanish regional-variant equivalence logic.
- Do not redesign the confirmation prompt or make it non-blocking.
- Do not implement generic stale-response cancellation or pagination
  invalidation beyond hiding presentation while confirmation is pending.

## Acceptance Examples

- FGE4-AE1. Given English is selected and BibleProject cards are visible, replacing
  `Bible Project` with `prodigal son` dispatches an English search without an
  `Estonian detected` confirmation.
- FGE4-AE2. Given English is selected, entering `resur` dispatches an English search
  without a `French detected` confirmation.
- FGE4-AE3. Given completed results, a load-more control, an error, or a no-results
  state exists for the previous query, entering text that legitimately opens a
  language confirmation hides all of those artifacts until the viewer chooses.
- FGE4-AE4. Given an explicit non-Latin script query or a distinctive accented
  foreign query, the current language-confirmation path remains available.
- FGE4-AE5. Given the viewer accepts a genuine confirmation, the existing
  detected-language search flow proceeds unchanged; choosing a language
  manually through the `LanguageCombobox` searches with that language and
  dismisses the pending suggestion without a new decline control.

## Origin Trace

| Fix requirement | Origin coverage refined                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| FGE4-R1         | R4 and AE2: ambiguous queries continue with the visible selected language                                   |
| FGE4-R2         | R1-R2 and AE1-AE2: detection remains available only when evidence is useful and confident                   |
| FGE4-R3         | F1, R2, and R10: the visible pending suggestion remains the truthful current search state                   |
| FGE4-R4         | R3-R4 and AE1-AE2: accepting confirms detection; otherwise the visible selection remains authoritative      |
| FGE4-R5         | R11 and AE5: multilingual search behavior has regression coverage                                           |
| FGE4-R6         | R9 and the origin scope boundaries: search-language work remains isolated from adjacent language identities |

## Implementation Units

### U1. Track the bounded FGE-4 regression

- **Goal:** Record the scoped fix and its relationship to the existing Watch
  multilingual-search foundation.
- **Requirements:** FGE4-R1-FGE4-R6
- **Dependencies:** None
- **Files:**
  - `docs/roadmap/content-discovery/feat-309-watch-english-query-language-detection.md`
  - `docs/roadmap/README.md`
- **Approach:** Add the next unreserved content-discovery roadmap feature,
  initially in progress, with FGE-4's exact corpus and the explicit FGE-22 and
  FGE-23 boundaries. Complete it only after focused validation and browser
  proof.
- **Patterns to follow:** `docs/roadmap/content-discovery/feat-196-watch-multilingual-search-behavior.md`
  and neighboring current roadmap entries.
- **Test scenarios:** Test expectation: none -- this unit is coordination
  documentation.
- **Verification:** The roadmap row and feature file agree on status, scope,
  source ticket, verification, and completed evidence.

### U2. Add the selected-English detector prior

- **Goal:** Prevent false foreign-language prompts for the full FGE-4 English
  corpus without weakening explicit multilingual signals.
- **Requirements:** FGE4-R1, FGE4-R2, FGE4-R5, FGE4-R6
- **Dependencies:** U1
- **Files:**
  - `apps/web/src/lib/search-query-language.ts`
  - `apps/web/src/lib/search-query-language.test.ts`
  - `apps/web/src/lib/search-query-language.tinyld.test.ts`
- **Approach:** Before accepting a TinyLD result for an ambiguous Latin-script
  query, retain selected English when the normalized text has fewer than four
  language tokens or fewer than 20 letters and has no Unicode Latin diacritic
  after canonical decomposition. Keep the existing script-hint path ahead of
  this prior and leave sufficiently long or distinctively marked Latin text on
  the existing confidence path. Add deterministic mocked tests for both
  thresholds and the Unicode mark rule plus real TinyLD regressions for every
  enumerated FGE4-R1 query and representative positive multilingual cases.
- **Patterns to follow:** Existing script-hint precedence, normalized public
  slug comparison, and the split between mocked policy tests and
  `.tinyld.test.ts` dependency-contract coverage.
- **Test scenarios:**
  1. Covers FGE4-AE1 with `prodigal son`, including TinyLD's Estonian output.
  2. Covers FGE4-AE2 with `resur`, including TinyLD's French output.
  3. Covers every enumerated FGE4-R1 query as a table-driven real TinyLD corpus.
  4. Covers FGE4-AE4 and FGE4-R2 with a non-Latin script query, an accented
     Spanish query, an accented Vietnamese query outside the current limited
     character ranges, and queries at both token and letter boundaries.
  5. A non-English selected language does not receive the English prior.
- **Verification:** Both detector suites pass and type checking accepts the
  named boundary helper/constants.

### U3. Suppress stale presentation during confirmation

- **Goal:** Make the visible result state truthful whenever search is paused
  for language confirmation.
- **Requirements:** FGE4-R3-FGE4-R5
- **Dependencies:** U2
- **Files:**
  - `apps/web/src/components/SearchOverlay.tsx`
  - `apps/web/src/components/__tests__/FloatingSearchProvider.test.tsx`
- **Approach:** Derive a pending-confirmation presentation branch directly from
  the existing suggestion state. Give the existing localized confirmation
  content `role="status"` with polite live-region behavior, and make the
  loading, error, empty, results, and load-more branches mutually exclusive
  with it. Preserve the existing confirmation handler and manual
  `LanguageCombobox` selection path; do not invent a decline handler or add an
  untranslated message.
- **Patterns to follow:** Existing `aria-live` status handling and overlay tests
  that simulate completed search state before changing the input.
- **Test scenarios:**
  1. Covers FGE4-AE3 with previously rendered cards and load-more control.
  2. Covers FGE4-AE3 with a previous no-results state.
  3. Covers FGE4-AE3 with a previous error state.
  4. Covers FGE4-R3 with a visible loading skeleton.
  5. Covers FGE4-AE5 by accepting a genuine confirmation and by selecting a
     language manually through `LanguageCombobox` after stale state has been
     suppressed.
  6. Positively asserts the localized confirmation is exposed as a polite
     status when it opens and that the status disappears after either choice.
- **Verification:** Focused provider tests pass; DOM assertions prove none of
  the previous-query semantics remain exposed while the prompt is open, and
  positive accessibility assertions prove the localized polite status appears
  and disappears with the confirmation lifecycle.

### U4. Validate and deliver FGE-4

- **Goal:** Prove the regression locally, complete the roadmap item, and hand
  off an independently reviewable PR.
- **Requirements:** FGE4-R1-FGE4-R6
- **Dependencies:** U2, U3
- **Files:**
  - `docs/roadmap/content-discovery/feat-309-watch-english-query-language-detection.md`
  - `docs/roadmap/README.md`
- **Approach:** Run focused tests, Web typecheck/lint/format checks, structured
  code review, and local browser verification of the exact production
  sequence. Record evidence, mark the roadmap feature complete, and link the
  ready PR back to FGE-4.
- **Patterns to follow:** Current Watch fixes' completion-evidence sections and
  one-scope ready PRs.
- **Test scenarios:**
  1. Browser covers FGE4-AE1 by searching `Bible Project` then `prodigal son`.
  2. Browser covers FGE4-AE2 with `resur`.
  3. Browser covers FGE4-AE3 with a genuine confirmation after completed results.
  4. Browser smoke confirms no new console errors and no new network path or
     material initial-load regression from the presentation-only change.
- **Verification:** Targeted suites, Web checks, browser proof, `git diff
--check`, PR checks, mergeability, and Linear state are all reported.

## Risks & Dependencies

- The four-token and 20-letter boundaries are a deliberately conservative
  FGE-4 policy for ambiguous unaccented Latin text, not a linguistic truth.
  FGE-23 remains responsible for broad calibration and may later replace them
  with measured acceptance rules.
- TinyLD can change behavior on dependency upgrades. The real corpus suite
  should fail visibly if its outputs or confidence shape change.
- Gating the DOM while the prompt is pending does not cancel late requests.
  FGE-22 remains responsible for the broader lifecycle and analytics contract.
- Open PR work for FGE-1 touches nearby detector and overlay code. This branch
  must remain semantically independent and resolve any future merge conflict by
  preserving both the Spanish-variant identity rule and this selected-English
  prior.

## Sources & Research

- Linear FGE-4 provides the exact production sequence and required regression
  terms.
- Production verification on 2026-07-24 reproduced `Estonian detected` for
  `prodigal son` and `French detected` for `resur`, each over the prior
  BibleProject grid.
- `apps/web/src/lib/search-query-language.ts` contains the current script hints,
  TinyLD confidence gates, and selected-language comparison.
- `apps/web/src/components/SearchOverlay.tsx` pauses dispatch for a suggestion
  but independently renders the previous search state.
- `docs/brainstorms/2026-06-19-watch-multilingual-semantic-search-requirements.md`
  defines the original confirmation semantics and prompt acceptance behavior.
- `docs/brainstorms/2026-07-14-universal-multilingual-watch-search-requirements.md`
  keeps language resolution distinct from semantic retrieval and ranking.
- `docs/solutions/ui-bugs/watch-semantic-search-language-metadata-confirmation-race.md`
  documents the established language-confirmation state boundary.
- `docs/solutions/logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md`
  documents the distinction between public language identity and internal
  locale/ranking representations.
