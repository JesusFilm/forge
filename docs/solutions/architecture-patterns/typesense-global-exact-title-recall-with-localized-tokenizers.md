---
title: "Combine global exact-title recall with localized Typesense tokenizers"
date: "2026-08-13"
last_updated: "2026-08-14"
category: "architecture-patterns"
module: "apps/admin Watch Search Candidate retrieval"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "A Typesense collection stores localized title fields that require different tokenizer locales."
  - "Search must recall every published exact localized title without trusting one inferred query language."
  - "Localized partial and typo behavior must remain available after exact recall is improved."
  - "New retrieval evidence must reuse an existing title ranker without double-scoring lexical or semantic hits."
  - "A Candidate search change must pass strict latency and capacity gates before activation."
tags:
  - "watch-search"
  - "typesense"
  - "multilingual-search"
  - "exact-title"
  - "localized-tokenizers"
  - "hybrid-retrieval"
  - "ranking"
  - "latency-guardrail"
---

# Combine global exact-title recall with localized Typesense tokenizers

## Context

Candidate Watch search queried multiple localized title fields together. The implementation plan records a Typesense 30.2 preflight in which the first `query_by` field's locale controlled query parsing, allowing a later differently tokenized title field to miss. This was a retrieval problem: the ranker cannot promote a video that never enters the candidate set.

The fix is deliberately Candidate-only. It does not change Current search, the public GraphQL contract, Watch frontend behavior, playback-language selection, or semantic weights. It requires a fresh private Evaluation generation before it can be measured; an Evaluation pointer does not promote it to public Serving.

## Guidance

### Separate equality recall from tokenized recall

Keep two representations of localized titles:

- Existing `title_<locale>` fields remain responsible for language-aware partial and typo matching.
- Candidate documents additionally store deduplicated `title_exact_keys`, produced by shared Unicode normalization and a fixed-size hash.

The exact key removes tokenizer choice from whole-title equality. It does not replace the original localized title text or create another global fuzzy-search field.

The defining projection and normalization live in:

- `apps/admin/src/services/typesense-watch-search-exact-title.ts`
- `apps/admin/src/services/typesense-watch-search-lexical.ts`
- `apps/admin/src/services/typesense-watch-search-schema.ts`

### Add one logical lookup, not one lookup per language

Candidate adds one exact-key subsearch to the existing Typesense `multi_search` request. That lookup disables prefix and typo matching. Localized title, metadata, and optional semantic retrieval continue in the same HTTP batch.

Language evidence only orders the localized fields; it does not exclude other languages. This keeps HTTP and logical-subsearch fan-out bounded as language coverage grows; field count and request size still grow with the manifest and remain qualification-gated. It also avoids choosing one language for an ambiguous or cross-language query.

The request composition is in `apps/admin/src/services/typesense-watch-search.service.ts`, with language ordering in `apps/admin/src/services/typesense-watch-search-query-plan.ts` and `apps/admin/src/services/typesense-watch-search-locales.ts`.

### Treat the key as recall evidence, not relevance truth

After an exact-key hit is returned, Candidate re-reads the document's original localized titles. It grants exact proof only when the key agrees and an original title passes the existing locale-aware whole-title classifier.

This verification protects against stale projections, normalization drift, and theoretical key collisions. The exact and localized partial hits are then merged by canonical video and member video before scoring.

### Reuse the title lane and leave semantic scoring alone

Verified exact proof feeds the existing title lane as the strongest whole-title match. It is not a new score and does not get another reciprocal-rank contribution.

That gives one video one title contribution even when both exact and partial retrieval found it. Duplicate canonical videos with the same exact title receive equal title evidence; existing ranking signals break their tie. Metadata and semantic lanes retain their existing weights and behavior, including semantic fallback when there is no trustworthy title anchor.

### Report retrieval provenance separately from ranking evidence

Private Candidate diagnostics should record every retrieval lane that recalled a result: global exact title, localized title, metadata, and semantic. A canonical result can carry more than one source because several physical members or lanes may recall the same video before deduplication.

Retrieval provenance answers "how did this result enter the candidate set?" It does not answer "why did this result win?" Keep the latter in the ranking evidence fields. The Admin comparison card therefore shows `Found by` source badges separately from `Winning evidence`.

Collect this provenance only for diagnostic requests. Merge sources while candidates and canonical groups are deduplicated, use a fixed display order, and leave public search response construction unchanged. This adds no Typesense subsearch or network round trip and does not change title, metadata, or semantic contributions.

Compatibility fallback cannot reliably separate its combined lexical query into localized-title and metadata sources. Report only the source that is provable there, such as semantic overlap, and show `Not captured` when no source can be distinguished. Do not invent a label from the final ranking tier.

The diagnostic contract and private comparison UI live in:

- `apps/admin/src/services/typesense-watch-search.service.ts`
- `apps/admin/src/app/dashboard/search/compare/watch-search-comparison.tsx`

Regression coverage must include one result recalled by every native lane, canonical-sibling playback selection, and lexical-plus-semantic overlap in the compatibility fallback. These cases protect source union without changing scoring.

### Make activation a measured decision

Because the schema and retrieval contract changed, Candidate uses a new application revision and must be rebuilt as an immutable Evaluation generation. Candidate fails closed when its compatible generation is unavailable; it does not retry against Current aliases.

Public Serving activation requires evidence tied to the same Candidate generation and Current baseline; publication to private Evaluation does not. The gates cover multilingual relevance, caller/Admin/Typesense p50-p95-p99 latency, HTTP and logical subsearch counts, retries, hydration bounds, RAM, disk, build/import duration, fixed-load behavior, interference with Current traffic, and operator review. A gate is not satisfied without a non-empty artifact reference.

The guardrails are implemented in:

- `apps/admin/src/services/typesense-watch-search-candidate-qualification.ts`
- `apps/admin/src/services/typesense-watch-search-candidate-generation.ts`
- `apps/admin/src/scripts/index-typesense-watch-search-candidate.ts`
- `apps/admin/src/scripts/benchmark-watch-search-candidate.ts`
- `apps/admin/src/scripts/watch-search-candidate-benchmark-cases.ts`
- `docs/operations/typesense-watch-search-production-readiness.md`

## Why This Matters

The implementation plan records a local Typesense 30.2 preflight in which no tested single global tokenized field preserved exact, partial, punctuation, and supported typo behavior across the representative Han, Kana, Cyrillic, Arabic, and Latin cases. The plan rejected script-specific hard filters because ambiguous and cross-language-sharing queries can lose valid titles, while per-language request fan-out would increase with language coverage.

The split-lane design gives equality a tokenizer-independent path while retaining the language-specific tokenizers for the jobs they perform well. Merging the evidence before title scoring prevents double counting. Keeping the additional lookup inside the existing batch avoids a new network round trip, while qualification makes any remaining latency or resource cost visible before public activation.

## When to Apply

- Exact localized titles are indexed but can be absent from retrieval because fields use different tokenizer locales.
- One inferred query language is not reliable enough to hard-filter a multilingual catalog.
- Partial and typo matching still need locale-specific analysis.
- An existing hybrid ranker already distinguishes strong title intent from conceptual semantic intent.
- Operators need to distinguish candidate recall from the evidence that determined final rank.
- The system has private Candidate and public Serving boundaries that can keep an unqualified projection dark.

## Examples

For exact native titles such as `Иисус`, `耶稣`, `耶穌`, `イエス`, and `يسوع`, the exact-key lookup can recall the matching localized document regardless of the first tokenizer field. Candidate then verifies the original localized title and marks the existing title evidence as a whole-title match.

When a partial title, typo, or conceptual query is not also a normalized whole-title match, the exact lookup provides no proof. Localized title or semantic retrieval continues to determine the candidates and the established ranker keeps its normal mode.

## Related

- `docs/solutions/logic-errors/watch-search-chinese-lexical-playback-language-conflation.md` explains why query text, tokenizer locale, and playback language are different concerns.
- `docs/solutions/logic-errors/canonical-language-boundaries-and-lexicographic-search-ranking.md` defines the locale-aware whole-title classifier reused after recall.
- `docs/solutions/logic-errors/typesense-watch-search-rrf-brand-ranking-regression.md` defines the existing title-first Candidate ranking behavior.
- `docs/solutions/performance-issues/typesense-watch-search-payload-projection-latency.md` defines the no-new-round-trip and measured-latency guardrails.
- `docs/solutions/integration-issues/watch-search-candidate-generation-stable-application-revision.md` defines immutable Candidate generations and compatibility identity.
- `docs/solutions/best-practices/precomputed-hybrid-search-serving-index-20260803.md` describes the broader Candidate retrieval and Serving architecture.
- `docs/plans/2026-08-13-001-fix-candidate-native-language-query-routing-plan.md` is the implementation and qualification contract for this change.
