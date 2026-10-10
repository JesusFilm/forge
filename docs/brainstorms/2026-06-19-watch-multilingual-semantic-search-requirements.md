---
date: 2026-06-19
topic: watch-multilingual-semantic-search
---

# Watch Multilingual Semantic Search

## Summary

Semantic search should make the search language visible and correct before a viewer commits a query. The search bar detects the likely language of the typed query, previews a confident "Search in <language>" suggestion, and runs semantic search in that language when the suggestion is confirmed.

---

## Problem Frame

Watch serves a global audience trying to find videos in languages they can understand. Today, a viewer can type a query in one language while the search context remains another language, which can make valid multilingual searches feel like empty or wrong searches.

The product already has a global modal search surface and language-aware search plumbing. This brainstorm narrows the next improvement to semantic search behavior: make query-language mismatch visible, let the viewer confirm the detected language, and keep a manual language selector available.

---

## Key Decisions

- **Semantic search only.** This v1 improves the semantic search path and does not change Algolia search behavior.
- **Visible detected-language suggestion.** A confident detected query language becomes a visible pending suggestion before search runs, instead of silently switching behind the viewer.
- **Enter can confirm the visible suggestion.** When a confident suggestion is visible, pressing Enter searches in that detected language; otherwise Enter uses the visible manual language selection.
- **Simple default language priority.** The default search language is website/watch language, then browser/device language, then English.
- **Search language stays separate from watch language.** Choosing or confirming a search language does not change the site language, route language, or audio language.

---

## Actors

- A1. Watch viewer: Searches for faith content from the global search modal.
- A2. Multilingual viewer: Types a query in a language that may differ from the current website/watch language.
- A3. Implementing engineer or agent: Plans the feature without changing Algolia search, route language, or audio language semantics.

---

## Key Flows

- F1. Query language suggestion
  - **Trigger:** A viewer types a query whose likely language differs from the current selected search language.
  - **Actors:** A1, A2
  - **Steps:** The search bar detects a likely supported query language, shows a visible "Search in <language>" suggestion, and makes that suggestion the pending search language while it remains visible.
  - **Outcome:** The viewer can tell which language search will use before committing.
  - **Covered by:** R1, R2, R3, R4

- F2. Confirmed semantic search
  - **Trigger:** A viewer presses Enter or selects the detected-language suggestion while it is visible.
  - **Actors:** A1, A2
  - **Steps:** The search runs through semantic search using the detected language, and results link to Watch pages without mutating the viewer's site or audio language.
  - **Outcome:** A Spanish query on an English page can return Spanish semantic results when the suggestion is visible and confirmed.
  - **Covered by:** R2, R3, R6, R7

- F3. Manual language selection
  - **Trigger:** A viewer opens the language selector or changes the selected search language.
  - **Actors:** A1, A2
  - **Steps:** The viewer chooses a search language manually; future searches in the current modal session use that visible selection unless a confident query-language suggestion is accepted.
  - **Outcome:** The viewer keeps control when detection is wrong, low-confidence, or not desired.
  - **Covered by:** R5, R6, R8

- F4. No-result explanation
  - **Trigger:** Semantic search returns no results in the selected language.
  - **Actors:** A1, A2
  - **Steps:** The empty state explains that results may exist in another language and exposes the language selector or a detected-language retry when available.
  - **Outcome:** A no-result state becomes recoverable instead of feeling like final failure.
  - **Covered by:** R9, R10

---

## Requirements

**Semantic Search Language Behavior**

- R1. The search bar must detect the likely language of the typed query when enough query text exists to make a useful guess.
- R2. When detection is confident, supported, and different from the visible selected search language, the UI must show a visible suggestion to search in the detected language.
- R3. When the detected-language suggestion is visible, pressing Enter must confirm that suggestion and run semantic search in the detected language.
- R4. When detection is low-confidence, unsupported, or unavailable, pressing Enter must run semantic search using the visible selected search language.
- R5. A manual language selector must be available so the viewer can choose the semantic search language directly.

**Default Language Priority**

- R6. The initial selected search language must default to the current website/watch language when available.
- R7. If the website/watch language is unavailable, the selected search language must fall back to browser/device language when supported.
- R8. If neither website/watch language nor browser/device language is usable, the selected search language must fall back to English.

**Scope Safety**

- R9. Search-language confirmation must not change the website language, route language, audio language, or persisted watch-language setting.
- R10. No-result states must explain when results may exist in another language and offer a recovery path through language selection or a detected-language retry.
- R11. Multilingual semantic behavior must be covered by the search eval suite with cases where query language differs from website/watch language.

---

## Acceptance Examples

- AE1. Spanish query on English Watch page
  - **Given:** The selected search language is English.
  - **When:** The viewer types a Spanish query and the system confidently detects Spanish.
  - **Then:** The search bar shows a "Search in Spanish" suggestion, and pressing Enter runs semantic search in Spanish.
  - **Covers:** R1, R2, R3

- AE2. Low-confidence query
  - **Given:** The selected search language is English.
  - **When:** The viewer types a short or ambiguous query whose language cannot be confidently detected.
  - **Then:** No detected-language suggestion becomes active, and pressing Enter searches in English.
  - **Covers:** R4

- AE3. Manual language override
  - **Given:** The viewer manually selects French as the search language.
  - **When:** The viewer searches without accepting a different detected-language suggestion.
  - **Then:** Semantic search uses French for that search.
  - **Covers:** R5, R6, R9

- AE4. No results in selected language
  - **Given:** Semantic search returns no results in the selected language.
  - **When:** Another supported language is plausible from the query or available through the selector.
  - **Then:** The empty state explains that results may exist in another language and offers a language-based recovery path.
  - **Covers:** R10

- AE5. Eval coverage
  - **Given:** The search eval suite includes multilingual cases.
  - **When:** A query language differs from website/watch language.
  - **Then:** The suite can verify that semantic search runs in the expected language after the suggestion is confirmed.
  - **Covers:** R11

---

## Success Criteria

- Viewers can see the semantic search language before search submission.
- A confident query-language suggestion prevents obvious cross-language no-result failures.
- The manual selector remains available for correction and control.
- The v1 change does not alter Algolia behavior or any persisted watch-language setting.
- Search evals protect the mismatch case: query language differs from website/watch language.

---

## Scope Boundaries

- Algolia search behavior is out of scope.
- Persisting a saved search-language preference is deferred.
- Using the viewer's audio-language setting as a default input is out of scope.
- Changing website/watch language, route language, or audio language as a side effect of search is out of scope.
- Full search-ranking optimization is deferred; this feature focuses on selecting the right semantic search language.

---

## Dependencies / Assumptions

- The current global search modal remains the canonical search surface.
- Semantic search can accept a selected language or locale at search time.
- Query-language detection can produce a confidence signal good enough to decide whether to show the suggestion.
- Browser/device language is available only as a fallback signal, not as a persisted preference.

---

## Sources / Research

- Product context: `PRODUCT.md`
- Repo constraints: `AGENTS.md`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`
- Prior search modal requirements: `docs/brainstorms/2026-06-10-forge-algolia-search-modal-requirements.md`
- Search modal pattern: `docs/solutions/architecture-patterns/forge-algolia-search-modal-20260610.md`
- Search action boundary: `apps/web/src/lib/search-actions.ts`
- Search language resolver: `apps/web/src/lib/search-language.ts`
- Current no-result state: `apps/web/src/components/SearchOverlay.tsx`
- UX grounding: [NN/g site search suggestions](https://www.nngroup.com/articles/site-search-suggestions/), [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), [Baymard autocomplete UX](https://baymard.com/blog/autocomplete-design)
