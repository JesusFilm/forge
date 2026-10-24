---
title: "Separate dropped-token suggestion recall from display proof"
date: "2026-08-23"
category: "logic-errors"
module: "apps/admin Watch search suggestions"
problem_type: "logic_error"
component: "service_object"
severity: "medium"
symptoms:
  - "A relevant multi-word query returned no suggestions when one query token was absent from the catalog title"
  - "Short or generic queries risked becoming noisy if token dropping was enabled without a local relevance boundary"
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "typesense"
  - "testing_framework"
tags:
  - "watch-search"
  - "search-suggestions"
  - "typesense"
  - "dropped-tokens"
  - "phrase-validation"
  - "deterministic-ranking"
  - "language-identity"
---

# Separate dropped-token suggestion recall from display proof

## Problem

Watch autocomplete could return nothing for a useful near-miss query such as
`Jesus for kids` when the catalog title was `The Story of Jesus for Children`.
The candidate request required every query token to match, so the candidate was
removed before phrase extraction or title ranking could inspect it.

## Symptoms

- A strong title disappeared because one longer-query token did not match.
- The empty suggestion panel gave no hint that related catalog content existed.
- Enabling Typesense token dropping alone would admit candidates without proving
  that they were relevant enough to display.

## What Didn't Work

- Keeping `drop_tokens_threshold: 0` at candidate recall preserved precision but
  made later ranking powerless because the relevant record never entered the
  candidate set.
- Treating Typesense's dropped-token result as relevance proof was insufficient;
  Typesense may drop more tokens than the product allows.
- Applying relaxed coverage without carrying its evidence tier across canonical
  groups allowed weaker matches to inherit the backend's candidate order.

## Solution

Broaden only the candidate seam, then re-establish relevance locally:

1. Enable Typesense token dropping only for queries with at least three unique
   Unicode word tokens.
2. Require local coverage of every unique query token except at most one, with
   at least one matched non-stop-word token.
3. Use the same Unicode tokenizer for query tokens and relaxed title tokens so
   apostrophes and hyphens do not create artificial misses.
4. Keep exact, title-prefix, and word-prefix evidence above the relaxed title
   tier, and sort the chosen tier globally before using Typesense order as the
   stable tie-break.
5. Extract fallback phrases from a bounded number of meaningful anchors, then
   validate every displayed phrase with a strict Typesense request using
   `drop_tokens_threshold: 0` and the exact `languageIdentity` filter.
6. Keep metadata direct matches on the existing strict tiers and preserve all
   response, candidate, concurrency, cache, and timeout bounds.

The implementation lives in
`apps/admin/src/services/typesense-watch-search-suggestions.ts`. The focused
tests cover near-miss recovery, short-query strictness, stop-word-only overlap,
over-dropped candidates, title-only relaxed direct matching, tier precedence,
compound tokens, strict phrase validation, and metadata-derived phrases.

## Why This Works

Recall and relevance answer different questions. Dropped-token retrieval asks
whether a record is worth inspecting; it does not decide whether the record or
an extracted phrase should be shown. Local bounded coverage rejects candidates
that Typesense relaxed too far, the named tier preserves exact evidence, and
strict phrase validation guarantees that submitting a displayed phrase still
returns a lexical result in the selected language.

## Prevention

- When relaxing a retrieval seam, add a separate local proof with explicit
  false-positive tests; never grant a stronger ranking tier from recall
  provenance alone.
- Tokenize both sides of a coverage comparison with the same rules, including
  apostrophes, hyphens, and Unicode normalization.
- Test cross-record ordering with the weaker candidate first so backend order
  cannot hide a missing comparator key.
- Keep exact language slug identity separate from BCP-47 tokenizer selection.

## Related Issues

- `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`
- `docs/solutions/architecture-patterns/typesense-global-exact-title-recall-with-localized-tokenizers.md`
- `docs/solutions/logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md`
- `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md`
- `docs/roadmap/content-discovery/feat-412-watch-search-suggestion-multi-token-recall.md`
