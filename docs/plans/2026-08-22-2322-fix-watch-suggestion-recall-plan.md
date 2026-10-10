---
title: "Watch Suggestion Recall - Plan"
type: fix
date: 2026-08-22
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Watch Suggestion Recall - Plan

## Goal Capsule

- **Objective:** Watch search returns useful suggestions for relevant near-miss multi-word queries without making short or generic queries noisy.
- **Means:** Broaden only candidate recall, then apply bounded token coverage, strict phrase validation, and a lower deterministic content-match tier (KTD1, KTD2, KTD3).
- **Authority:** This plan and `docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md` define scope. Existing Watch suggestion and language-identity contracts remain authoritative.
- **Execution profile:** Complete the bounded service and test diff, repair roadmap bookkeeping, validate the admin scope, and ship one PR.
- **Stop conditions:** Stop if the change requires a GraphQL/schema contract, generated output, UI work, or a broader search-ranking redesign.

## Product Contract

### Summary

Improve Watch suggestions for queries such as `Jesus for kids` when the catalog title is `The Story of Jesus for Children`. Keep displayed suggestions relevant, language-correct, bounded, and deterministically ordered.

### Problem Frame

The current candidate request requires every query token to match. One unmatched word can therefore remove an otherwise strong title before phrase extraction or direct-content ranking can evaluate it.

### Key Decisions

- **Broaden recall only for longer queries.** (session-settled: user-directed — chosen over retaining strict all-token recall: strict recall produced no suggestions for relevant near-miss phrases.) Governs R1, R4.
- **Add both phrase and title recovery.** (session-settled: user-directed — chosen over implementing only one recovery lane: the requested options require both useful query completions and direct content matches.) Governs R2, R3.
- **Do not add an empty-state UI.** (session-settled: user-directed — chosen over masking the retrieval gap in the interface: the requested fix targets suggestion relevance.) Governs R5.

### Requirements

- R1. The candidate request may activate Typesense token dropping only when the normalized query contains at least three unique word tokens; client-side phrase and title eligibility may accept at most one unmatched query token.
- R2. Phrase fallback must anchor on meaningful query-token matches, satisfy bounded one-drop coverage, and pass the existing strict lexical validation before display.
- R3. A multi-word title match may use bounded token coverage only in a tier below exact, title-prefix, and word-prefix matches; metadata fields retain their existing strict match tiers.
- R4. One-token and two-token queries remain strict, and accepted relaxed matches must include at least one non-stop-word query token.
- R5. The change must not alter GraphQL, Web, schema, generated artifacts, or empty-state behavior.
- R6. Ranking, grouping, language identity, validation order, response caps, and failure isolation remain deterministic and compatible with the existing suggestion contract.
- R7. Roadmap dependencies remain bidirectional and the generated roadmap index includes the completed feature.

### Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given `Jesus for kids` and a candidate titled `The Story of Jesus for Children`, the service returns the validated phrase `Jesus for Children` and the direct content suggestion.
- AE2. **Covers R4.** Given `purple kids` and a candidate titled `Purple Rain`, the candidate request does not enable token dropping and the service returns no suggestion.
- AE3. **Covers R4, R6.** Given `the story of` and a candidate whose only overlap is stop words, the service returns no phrase or content suggestion.

### Scope Boundaries

- No UI empty-state changes.
- No GraphQL, schema, collection-schema, or generated-client changes.
- No replacement of the existing suggestion ranking model or language-identity filtering.

## Planning Contract

### Key Technical Decisions

- KTD1. **Separate candidate recall from display proof.** (session-settled: user-directed — chosen over using strict matching at both seams: strict candidate recall cannot admit the relevant title.) The candidate request may use one-drop recall per R1, while phrase validation keeps `drop_tokens_threshold: 0` and client-side coverage rejects over-dropped candidates. This follows `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`.
- KTD2. **Keep relaxed title matches last.** (session-settled: user-directed — chosen over replacing the existing title-prefix tiers: exact and prefix evidence must retain ranking priority.) Carry the selected match tier into each direct title candidate and sort title candidates by tier before using Typesense group order as the stable tie-breaker. Metadata candidates keep their existing strict match tiers. This follows `docs/solutions/logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md`.
- KTD3. **Centralize bounded token coverage.** Normalize with the existing Unicode-aware word tokenizer, deduplicate query tokens, allow at most one unmatched token for three-or-more-token queries, and require one matched meaningful token. Reuse this predicate for phrase fallback and direct content classification.
- KTD4. **Bound fallback work.** Preserve the existing phrase-window size and edge-stop-word rules, and cap meaningful-token anchor scanning per candidate value.

### Assumptions

- Typesense may return candidates that dropped more than one token after the threshold activates. Client-side coverage is the relevance boundary for those candidates.
- The English-centric stop-word set is existing behavior. This PR does not introduce multilingual stop-word modeling.

### Risks and Deferred Follow-Up

- A strict raw Typesense hit can prevent dropped-token fallback even when local display proof later rejects that hit. The approved threshold-one mechanism remains in scope; add a second candidate pass only if production or evaluation evidence shows this path is material.
- Non-English function words are not modeled by the current stop-word set. Strict phrase validation and bounded token coverage remain the safeguards in this PR; multilingual stop-word modeling is deferred.

## Implementation Units

### U1. Bounded multi-token suggestion recall

- **Goal:** Recover relevant near-miss phrase and content suggestions while preserving stricter and higher-ranked behavior.
- **Requirements:** R1, R2, R3, R4, R5, R6; KTD1, KTD2, KTD3, KTD4.
- **Dependencies:** None.
- **Files:**
  - `apps/admin/src/services/typesense-watch-search-suggestions.ts`
  - `apps/admin/src/services/typesense-watch-search-suggestions.test.ts`
- **Approach:** Extend the existing candidate request and phrase-window extraction. Make bounded token coverage opt-in for title matching only. Carry the chosen title tier into direct candidates so exact and prefix matches sort before relaxed matches across Typesense groups. Keep metadata matching, the strict validation request, and exact `languageIdentity` filter unchanged. Add characterization-first regression coverage around the recalled candidate, accepted phrase, lower content tier, short-query boundary, stop-word guard, metadata boundary, and deterministic precedence.
- **Patterns to follow:** `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`, `docs/solutions/architecture-patterns/typesense-global-exact-title-recall-with-localized-tokenizers.md`, and `docs/solutions/logic-errors/typesense-watch-search-rrf-brand-ranking-regression.md`.
- **Test scenarios:**
  - Covers AE1. A three-token near miss enables candidate token dropping, validates the extracted phrase with strict lookup, and returns phrase before content.
  - Covers AE2. A two-token query keeps dropped-token recall disabled and rejects a partial title overlap.
  - Covers AE3. A three-token query whose candidate overlaps only on stop words yields no suggestion.
  - A one-token query keeps dropped-token recall disabled.
  - An existing exact or prefix match ranks ahead of a relaxed multi-token title match regardless of candidate input order.
  - A description-only partial-token overlap does not qualify through the relaxed title tier.
  - A repeated query token does not expand the allowed drop count or destabilize ordering.
- **Verification:** The focused suggestion suite and adjacent Watch search suites pass with unchanged language, grouping, validation-cache, and deterministic-order behavior.

### U2. Roadmap integrity

- **Goal:** Record feat-412 as completed without leaving dependency or generated-index drift.
- **Requirements:** R7.
- **Dependencies:** U1.
- **Files:**
  - `docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md`
  - `docs/roadmap/content-discovery/feat-352-watch-search-suggestion-result-validation.md`
  - `docs/roadmap/README.md`
- **Approach:** Keep feat-412 complete, add its reverse dependency to feat-352, and regenerate the roadmap index through the repository-owned generator.
- **Test expectation:** none -- this unit changes roadmap metadata and generated documentation only.
- **Verification:** Roadmap dependency metadata is bidirectional and the generated index contains feat-412 with no unrelated roadmap changes.

## Verification Contract

- `pnpm --filter @forge/admin test -- src/services/typesense-watch-search-suggestions.test.ts src/graphql/queries/watch-search.test.ts`
- `pnpm --filter @forge/admin typecheck`
- `pnpm --filter @forge/admin lint`
- `pnpm exec prettier --check apps/admin/src/services/typesense-watch-search-suggestions.ts apps/admin/src/services/typesense-watch-search-suggestions.test.ts docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md docs/roadmap/content-discovery/feat-352-watch-search-suggestion-result-validation.md docs/roadmap/README.md`
- Run the repository-owned roadmap README generator and confirm it produces no additional diff on a second run.
- Run `git diff --check` and confirm only plan-scoped files changed.

## Definition of Done

- U1 satisfies every listed test scenario and preserves the strict displayed-phrase validation contract.
- U2 leaves roadmap dependencies and the generated index consistent.
- All applicable verification gates pass, or an environment-only blocker is recorded with the direct installed-binary evidence used instead.
- The branch contains no generated GraphQL changes, lockfile churn, unrelated edits, or abandoned experimental code.
- The completed work is committed, pushed, and represented by an open PR with its validation evidence summarized.
