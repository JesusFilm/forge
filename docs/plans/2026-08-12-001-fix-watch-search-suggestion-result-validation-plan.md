---
title: "Guarantee Watch query suggestion results"
type: fix
status: completed
date: 2026-08-12
---

# Guarantee Watch query suggestion results

## Summary

Validate each ranked Watch query phrase against the selected language's lexical Typesense projection before returning it. Use one bounded multi-search request for uncached phrases and a short process-local verdict cache, while leaving direct matches and explicit search submission unchanged.

## Problem Frame

Watch autocomplete currently extracts plausible words and phrases from the title and description text of its initial lexical hits. A derived phrase can still produce no lexical result when submitted because extraction is not an existence check. Rendering those phrases as search suggestions creates a stronger promise than the backend currently proves.

## Requirements

### Result guarantee

- R1. Every returned `kind: "query"` suggestion has at least one lexical Typesense hit for the exact selected public language identity at validation time.
- R2. Validation preserves the existing ranked phrase order and returns only phrases with a confirmed positive verdict; negative or unavailable verdicts remove the phrase as specified in R5-R6.
- R3. The service validates no more than the existing six ranked phrase candidates.

### Cost and resilience

- R4. All uncached phrase checks for one autocomplete request run in one Typesense `multiSearch` call with `per_page: 1` and a minimal response projection.
- R5. Positive and negative validation verdicts use a bounded 60-second process-local cache keyed by validation contract version, exact language identity, and normalized phrase.
- R6. Transport errors, sub-search errors, and malformed or positionally incomplete batch responses are not cached and suppress query phrases without suppressing hydrated direct matches.
- R7. The existing public field-occurrence cap, rate limit, identical-request coalescing, and service-wide concurrency ceiling continue to bound the complete candidate-plus-validation operation.

### Compatibility

- R8. Direct content matching, GraphQL response shape, Web rendering, explicit submission, language selection, and search analytics remain unchanged.
- R9. Focused tests prove request bounds, exact-language filtering, ordering, partial cache reuse, expiry, negative caching, malformed response handling, deadline degradation, and direct-match preservation.

## Assumptions

- A lexical hit is the appropriate near-term existence guarantee because the submitted Watch search is broader than the lexical suggestion lane; this change does not invoke the full hybrid retrieval pipeline while typing.
- The existing Typesense lexical alias is the validation source of truth. A short TTL bounds staleness across alias rebuilds without adding index-version resolution to the request path.
- At most six proposed phrases are validated. The service may return fewer than six rather than expanding the extraction pool after invalid candidates are removed.

## Key Technical Decisions

- **Validate after ranking:** Extract, deduplicate, rank, and cap phrases exactly as today, then filter them by verdict so validation cannot reorder suggestions.
- **Batch only cache misses:** Read cached verdicts first and send the remaining phrases as position-stable sub-searches in one `multiSearch` call. This avoids sequential network latency and allows a warm request to perform no validation call.
- **Reuse the candidate field policy:** Validation queries use the same localized title and metadata fields, weights, zero-typo posture, and exact `languageIdentity` filter as candidate generation, with `prefix: false`, `drop_tokens_threshold: 0`, and `per_page: 1`.
- **Cache verdicts across requests, not failures:** Store both `true` and `false` for 60 seconds in a module-scoped cache owned by the stable Prisma instance, not the per-request service or Typesense client. Use the existing bounded helper's insertion-order eviction semantics at 512 entries, and do not store a verdict when the batch fails or cannot be mapped one-to-one to its inputs.
- **Degrade phrases independently:** Isolate validation failure from initial retrieval and direct-match hydration. Return direct matches when available and omit only unverified query phrases.
- **Bound the dependent stage:** Give phrase validation a 750-millisecond Typesense deadline so the initial request's 2-second budget plus validation remains below Web's 3.5-second autocomplete timeout. A validation timeout cancels its Typesense request, releases the service slot, and degrades to direct matches.

## Scope Boundaries

- No precomputed phrase index, result counts, content-ID lists, popular searches, search history, personalization, or query-log serving.
- No semantic search, transcript search, watchability lookup, result-card hydration, or submitted-search trace from phrase validation.
- No GraphQL schema, generated client, Web component, localization, or interaction changes.

## Implementation Units

### U1. Track the result-validation follow-up

- **Goal:** Record the focused reliability extension and its dependency on the existing Watch suggestions feature.
- **Requirements:** R1-R9
- **Files:** `docs/roadmap/content-discovery/feat-352-watch-search-suggestion-result-validation.md`, `docs/roadmap/content-discovery/feat-337-watch-search-suggestions.md`, `docs/roadmap/README.md`
- **Approach:** Add the new content-discovery ticket as `in-progress`, depend on `feat-337`, and add the reverse `blocks` entry. Mark the new ticket complete only after review and browser verification.
- **Verification:** Roadmap dependencies are bidirectional and the ticket states the result guarantee and bounded-cost contract.

### U2. Add batched phrase validation and bounded verdict caching

- **Goal:** Filter extracted query phrases to language-scoped lexical phrases with at least one hit.
- **Requirements:** R1-R8
- **Files:** `apps/admin/src/services/typesense-watch-search-suggestions.ts`, `apps/admin/src/services/typesense-client.ts`, `apps/admin/src/services/bounded-ttl-promise-cache.ts`
- **Approach:** Build one existence request per uncached ranked phrase, call `multiSearch` once with a 750-millisecond deadline, map results by input position, cache successful boolean verdicts in a module-scoped Prisma-owned cache, and combine cached and fresh verdicts without changing order. Keep validation errors inside a phrase-only failure boundary so direct-match hydration survives.
- **Patterns to follow:** `apps/admin/src/services/bounded-ttl-promise-cache.ts`, `apps/admin/src/services/typesense-watch-search-suggestions.ts`, `docs/solutions/performance-issues/typesense-watch-search-payload-projection-latency.md`
- **Verification:** Code inspection shows no per-phrase network loop, no full-search dependency, and a bounded cache with explicit failure behavior.

### U3. Prove the guarantee and cost envelope

- **Goal:** Add regression coverage that distinguishes validation from extraction and protects the single-batch design.
- **Requirements:** R1-R9
- **Files:** `apps/admin/src/services/typesense-watch-search-suggestions.test.ts`, `apps/admin/src/services/typesense-client.test.ts`, `apps/admin/src/services/bounded-ttl-promise-cache.test.ts`
- **Test scenarios:**
  - Six ranked candidates produce one validation `multiSearch` containing at most six `per_page: 1` requests after the initial candidate call.
  - Validation requests use the same localized lexical fields and exact public language identity, without grouping, hydration fields, typo tolerance, or prefix completion.
  - Mixed positive and negative results retain only positive phrases in their original order while direct matches remain unchanged.
  - Positive and negative cache hits avoid repeat validation across service instances sharing one Prisma owner; a partial cache hit batches only misses; expiry revalidates; the entry bound evicts the oldest inserted verdict.
  - A transport error, sub-search error, wrong result count, or malformed result returns direct matches without query phrases and does not poison the cache.
  - A stalled validation is cancelled at 750 milliseconds, returns direct matches within Web's 3.5-second timeout, does not poison the cache, and releases the active-request slot.
  - A phrase that appears only under another language identity is not validated for the selected language.
  - Aliased identical inputs coalesce across both Typesense stages, while unique concurrent inputs remain subject to the existing operation occurrence cap and service-wide concurrency ceiling.
- **Verification:** Run the focused Admin Vitest file, Admin typecheck, formatting, and the existing public resolver regression tests.

### U4. Verify the integrated autocomplete behavior

- **Goal:** Confirm the backend hardening does not change the established modal behavior.
- **Requirements:** R1-R9
- **Files:** `docs/roadmap/content-discovery/feat-352-watch-search-suggestion-result-validation.md`, `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`
- **Approach:** Exercise autocomplete against local Admin and Typesense with a phrase that has results and a candidate that validation removes. Confirm direct matches still render when phrase validation is unavailable, then mark the roadmap ticket complete.
- **Verification:** Desktop and narrow-mobile browser smoke preserve the suggestions-first/direct-matches-second layout, language scope, cached refocus behavior, and explicit-submit boundary.

## Acceptance Examples

- AE1. **All candidates validate**
  - **Given:** Extraction ranks six unique phrases for the selected language.
  - **When:** The validation batch reports at least one lexical hit for each phrase.
  - **Then:** The six phrases render in their original order before direct matches.
  - **Covers:** R1-R4, R7
- AE2. **Some candidates have no result**
  - **Given:** Extraction ranks a phrase that has no lexical hit under the exact selected language identity.
  - **When:** Validation completes.
  - **Then:** That phrase is omitted while validated phrases and direct matches retain their order.
  - **Covers:** R1-R3, R7
- AE3. **Warm validation cache**
  - **Given:** Phrase verdicts were resolved less than 60 seconds ago.
  - **When:** A later autocomplete request proposes the same normalized phrases in the same language.
  - **Then:** Cached verdicts are reused and no Typesense validation request is made for those phrases.
  - **Covers:** R4, R5
- AE4. **Validation unavailable**
  - **Given:** Initial autocomplete retrieval and direct-match hydration succeed but phrase validation fails.
  - **When:** The response is assembled.
  - **Then:** The response contains direct matches and no query phrases, and the viewer can still submit the draft normally.
  - **Covers:** R6-R8

## Risks & Dependencies

- The added cold-cache Typesense round trip increases autocomplete latency by one bounded request. Batching, `per_page: 1`, minimal fields, and the short verdict cache constrain that cost.
- The validation stage has a 750-millisecond Typesense deadline so the two sequential stages fit under Web's existing 3.5-second autocomplete timeout even when the initial stage consumes its 2-second client budget.
- Typesense maps multi-search responses positionally. The service must reject result-count or shape mismatches rather than assigning a verdict to the wrong phrase.
- The result guarantee is lexical and point-in-time. A later index change can invalidate a cached verdict until the 60-second TTL expires.

## Sources

- `apps/admin/src/services/typesense-watch-search-suggestions.ts`
- `apps/admin/src/services/typesense-client.ts`
- `docs/solutions/design-patterns/watch-search-draft-suggestion-submit-separation.md`
- `docs/solutions/performance-issues/typesense-watch-search-payload-projection-latency.md`
- `docs/solutions/best-practices/precomputed-hybrid-search-serving-index-20260803.md`
- `docs/solutions/logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md`
- `docs/solutions/best-practices/batched-provider-input-position-stable-contract-20260505.md`
