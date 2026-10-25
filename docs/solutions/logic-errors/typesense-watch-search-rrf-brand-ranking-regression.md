---
title: "Keep strong title and brand evidence ahead of semantic-only Watch results"
date: "2026-08-12"
category: "logic-errors"
module: "apps/admin Typesense Watch search ranking"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "Users reported that public Watch search was unavailable during a full reindex and returned noticeably worse rankings after the reindex completed."
  - "The query the bible project returned the exact BibleProject collection first but then placed unrelated transcript-semantic matches ahead of related BibleProject content."
  - "The weighted fusion formula gave a rank-one semantic-only result about 2.14 times the contribution of a rank-one metadata-only result."
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "testing_framework"
  - "documentation"
tags:
  - "watch-search"
  - "typesense"
  - "hybrid-search"
  - "rrf"
  - "semantic-search"
  - "title-ranking"
  - "brand-ranking"
  - "candidate-profile"
---

# Keep strong title and brand evidence ahead of semantic-only Watch results

## Problem

Watch search fuses three native Typesense result lanes with reciprocal-rank fusion (RRF): title weight `0.56`, metadata weight `0.14`, semantic transcript weight `0.30`, and rank constant `60` (`apps/admin/src/services/typesense-watch-search.service.ts:86-89`). A rank-one semantic-only result therefore contributes `0.30 / 61`, while a rank-one metadata-only brand result contributes `0.14 / 61`; the semantic result receives about 2.14 times as much fused score. The implementation applies those formulas when it adds lexical and semantic lanes (`apps/admin/src/services/typesense-watch-search.service.ts:1786-1817`, `apps/admin/src/services/typesense-watch-search.service.ts:1857-1873`).

This reproduced the reported failure shape: an exact collection can remain first through the title lane, while an unrelated transcript-semantic result ranks above a video whose metadata identifies it with the collection or brand. The focused regression test first proves that legacy fused ordering places the semantic-only result above the metadata result, then proves the candidate ranking reverses only those lower positions (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:57-99`).

The exact production event that activated this behavior is still unproven. The reindex may have ended a compatibility path after `videoEditionId` became part of the transcript projection, but the retained production logs, old physical generation, old alias bindings, and old document counts needed to establish that causal chain were unavailable (`docs/plans/2026-08-12-001-fix-watch-search-title-brand-ranking-plan.md:35-41`). The durable conclusion is the reproduced RRF ranking defect, not an asserted reindex cause.

## Symptoms

- For `the bible project`, the matching collection could rank first while an unrelated semantic transcript ranked above a BibleProject video that matched through metadata; the CURRENT-versus-CANDIDATE integration fixture reproduces the legacy order as collection, semantic result, brand video (`apps/admin/src/services/typesense-watch-search.service.test.ts:775-869`).
- Users with explicit title, series, collection, or brand intent received conceptually similar transcript results before content belonging to the named entity, even though the metadata lane contained precise brand evidence (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:57-99`).
- A global semantic reduction would damage the second valid search persona: conceptual queries such as `hope after divorce` must continue to use the existing fused semantic order. The candidate integration test keeps that query in `SEMANTIC` mode with no ranking anchor and preserves its semantic result order (`apps/admin/src/services/typesense-watch-search.service.test.ts:1007-1064`).

## What Didn't Work

- Treating the reindex/compatibility-fallback hypothesis as the established root cause did not meet the evidence bar. It remains plausible, but the historical collections and telemetry needed to compare generations no longer existed in the available investigation context (`docs/plans/2026-08-12-001-fix-watch-search-title-brand-ranking-plan.md:35-41`).
- Globally changing RRF weights was rejected as the product model. One fixed scalar blend cannot express both explicit brand/title intent and conceptual transcript intent; the regression test demonstrates the former needs metadata promotion (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:57-99`), while the conceptual-query test demonstrates the latter must keep semantic ordering (`apps/admin/src/services/typesense-watch-search.service.test.ts:1007-1064`).
- Metadata alone is not strong enough to select the title-and-brand policy. The implementation requires an eligible title-lane anchor (`apps/admin/src/services/typesense-watch-search-ranking.ts:318-367`), and the regression suite verifies a metadata-only BibleProject hit leaves the query in `SEMANTIC` mode (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:153-177`). This prevents incidental metadata mentions from turning a conceptual query into a brand search.
- A BibleProject-specific exception was unnecessary. The implemented normalization and anchor rules also recognize other omitted-article brand/title forms such as `StoryClubs` / `The StoryClubs Collection` and `Week Away` / `A Week Away` (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:101-127`).

## Solution

The fix adds two automatic final-ranking modes behind the existing physical `CANDIDATE` profile. It does not add a user-facing toggle and does not change public `CURRENT`: the search service derives `title-and-brand-v1` only when `profile.kind === "CANDIDATE"`; every other profile uses `legacy-rrf` (`apps/admin/src/services/typesense-watch-search.service.ts:905-927`). The integration tests assert that CURRENT retains its old order and `legacy-rrf`, while CANDIDATE selects `title-and-brand-v1` and moves the brand video ahead of the semantic-only result (`apps/admin/src/services/typesense-watch-search.service.test.ts:854-943`).

The candidate policy works in five steps:

1. **Normalize title evidence deterministically.** Query and title values are Unicode-normalized, camel-case boundaries are split, punctuation and symbols become spaces, and values are locale-lowercased (`apps/admin/src/services/typesense-watch-search-ranking.ts:109-150`). Leading articles and generic content suffixes such as `collection`, `series`, and `videos` are removed only from the comparison core (`apps/admin/src/services/typesense-watch-search-ranking.ts:58-65`, `apps/admin/src/services/typesense-watch-search-ranking.ts:133-150`). This makes `BibleProject`, `Bible Project`, `the bible project`, and `BibleProject Collection` converge without a brand-specific alias (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:101-114`).
2. **Select a strong title-lane anchor.** Only title evidence within the bounded top-100 lane window may create an anchor (`apps/admin/src/services/typesense-watch-search-ranking.ts:81`, `apps/admin/src/services/typesense-watch-search-ranking.ts:318-354`). A normalized whole-title match wins; otherwise a multi-token normalized title core may anchor only when it belongs to one canonical result. Competing title-core candidates deliberately return no anchor and therefore remain semantic (`apps/admin/src/services/typesense-watch-search-ranking.ts:356-377`).
3. **Classify candidates into evidence tiers.** In title-and-brand mode, results are assigned `NORMALIZED_WHOLE_TITLE`, `UNIQUE_TITLE_CORE`, `ANCHOR_TITLE`, `ANCHOR_METADATA`, or `SEMANTIC_FILL` (`apps/admin/src/services/typesense-watch-search-ranking.ts:37-42`, `apps/admin/src/services/typesense-watch-search-ranking.ts:391-459`). Precise metadata promotion requires the anchor's multi-token sequence and rejects negative or multi-brand relationship contexts (`apps/admin/src/services/typesense-watch-search-ranking.ts:201-291`).
4. **Sort entity evidence before semantic fill, preserving existing ranking within a tier.** Evidence-tier order is lexicographic (`apps/admin/src/services/typesense-watch-search-ranking.ts:83-91`, `apps/admin/src/services/typesense-watch-search-ranking.ts:462-483`). When no anchor exists, every result remains `SEMANTIC_FILL` and uses the legacy whole-title/fused-score/canonical-id comparator (`apps/admin/src/services/typesense-watch-search-ranking.ts:380-389`, `apps/admin/src/services/typesense-watch-search-ranking.ts:434-443`).
5. **Reuse the existing retrieval request.** Title, metadata, and semantic lanes are collected exactly as before, and the candidate policy runs only after those lane groups have been fused into canonical groups (`apps/admin/src/services/typesense-watch-search.service.ts:1786-1935`). The feature introduces no additional Typesense retrieval call or logical subsearch; qualification fails when candidate call/subsearch counts differ from CURRENT or exceed their bounds (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:402-448`).

Candidate isolation remains intact. CURRENT uses the four existing aliases (`apps/admin/src/services/typesense-watch-search-profile.ts:68-73`, `apps/admin/src/services/typesense-watch-search-profile.ts:111-120`), while CANDIDATE must resolve to exact physical collections, must not use CURRENT aliases, and must use generation-prefixed catalog, availability, and lexical collections (`apps/admin/src/services/typesense-watch-search-profile.ts:123-180`). The private Admin comparison freezes CURRENT, resolves the `EVALUATION` candidate generation, and constructs one search service per profile (`apps/admin/src/services/typesense-watch-search-comparison.service.ts:294-327`); the page explicitly runs the same request without changing public Watch traffic (`apps/admin/src/app/dashboard/search/compare/page.tsx:25-51`).

Diagnostics expose the selected implementation and mode and record bounded per-canonical-result lane rank, lane contribution, fused score, evidence tier, selected video, watchability outcome, and final rank (`apps/admin/src/services/typesense-watch-search.service.ts:1352-1401`). The privacy projection deliberately retains only the anchor's canonical ID and match kind, excluding normalized query text, compact core, and tokens (`apps/admin/src/services/search-trace-privacy.ts:343-355`); its regression test verifies a credential-shaped query sentinel does not survive projection (`apps/admin/src/services/search-trace-privacy.test.ts:242-278`).

## Why This Works

The bug was not that semantic retrieval existed; it was that a single scalar RRF score treated semantic and explicit-title/brand evidence as interchangeable. The candidate policy first asks whether the retrieved title lane provides deterministic evidence that the query names a title, brand, series, or collection. If it does, it orders the matching title and its precise metadata family ahead of generic semantic fill. If it does not, it does not manufacture an anchor and preserves the existing semantic comparator (`apps/admin/src/services/typesense-watch-search-ranking.ts:416-483`).

This division serves both search intents without another model or network round trip. Exact and normalized title forms activate Title-and-Brand Mode (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:101-127`), while queries without an eligible normalized title-lane anchor—including ambiguous cores, accidental joined-word collisions, metadata-only matches, and conceptual queries—stay in Semantic Mode (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:129-177`). Locale-aware normalization also covers Turkish dotted and dotless `I` without collapsing distinct words (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:236-246`).

The ranking remains stable across input order and pagination because semantic ties fall back to canonical ID and the evidence tiers are deterministic. The unit suite verifies reordered candidate windows produce the same order and that concatenated pages reconstruct that order (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:264-323`); the service integration test verifies the same property through its public pagination inputs (`apps/admin/src/services/typesense-watch-search.service.test.ts:946-959`).

## Prevention

- Keep an explicit regression that proves both sides of the defect: legacy RRF must reproduce semantic-over-metadata ordering, and Title-and-Brand Mode must put the collection and precise metadata family before semantic fill (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:57-99`).
- Keep conceptual-query coverage beside title/brand coverage. Candidate tests must continue to prove that `hope after divorce` has no anchor and retains semantic ordering (`apps/admin/src/services/typesense-watch-search.service.test.ts:1007-1064`).
- Keep normalization and false-positive tests for joined/separated forms, articles, suffixes, multi-brand and negative metadata, mixed intent, multilingual case behavior, bounded promotion, deterministic ties, and pagination (`apps/admin/src/services/typesense-watch-search-ranking.test.ts:101-323`).
- Treat production-cause attribution separately from reproducing and fixing the ranking defect. A future generation investigation should retain alias targets, projection-field fallback events, schemas, import counts, and old physical generations long enough to compare before and after; this fix does not claim that the reindex ended compatibility fallback (`docs/plans/2026-08-12-001-fix-watch-search-title-brand-ranking-plan.md:35-44`).
- Keep qualification fail-closed. The benchmark compares candidate and current p50, p95, and p99 for caller-observed, server, Typesense wall, and Typesense server time, rejects any candidate regression, and enforces caller p95 below one second (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:359-399`). It also rejects mismatched retrieval calls, logical subsearches, larger responses, and extra hydrated records (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:402-448`).
- Do not promote from local tests alone. Qualification starts with relevance, fixed-load resource, current-interference, and operator-review evidence as `NOT_RUN` (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:149-154`) and adds a failure reason for every evidence gate that is not `PASS` (`apps/admin/src/scripts/benchmark-watch-search-candidate.ts:451-507`). The tests confirm missing evidence yields `NOT_QUALIFIED` and Typesense p95 regression blocks qualification (`apps/admin/src/scripts/benchmark-watch-search-candidate.test.ts:315-420`). A deployed candidate live benchmark and browser review through the private comparison page are therefore still required before promotion.
- Preserve diagnostic privacy whenever ranking evidence changes. Query-derived normalized anchors and detailed traces must remain outside the benchmark allowlist and privacy-safe comparison projection (`apps/admin/src/scripts/benchmark-watch-search-candidate.test.ts:440-458`, `apps/admin/src/services/search-trace-privacy.test.ts:242-278`).

## Related Issues

- [PR #1859](https://github.com/JesusFilm/forge/pull/1859) introduced the native three-lane Typesense fusion architecture whose weight interaction is reproduced here; the active weights and RRF constant are defined at `apps/admin/src/services/typesense-watch-search.service.ts:86-89`.
- [PR #1867](https://github.com/JesusFilm/forge/pull/1867) added `videoEditionId` to the transcript schema and motivated the compatibility-path hypothesis. That hypothesis remains explicitly unproven in this investigation (`docs/plans/2026-08-12-001-fix-watch-search-title-brand-ranking-plan.md:35-41`).
- [Precomputed hybrid search serving index](../best-practices/precomputed-hybrid-search-serving-index-20260803.md) defines the current Typesense retrieval, physical candidate profile, and qualification architecture extended here.
- [Canonical language boundaries and lexicographic search ranking](canonical-language-boundaries-and-lexicographic-search-ranking.md) establishes why categorical title evidence belongs in an earlier ordering key rather than an additive score.
- [Admin hybrid search keyword-first R4 extension](../platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md) is the PostgreSQL predecessor for the same semantic-dilution product problem; this Typesense implementation uses automatic candidate-only ranking instead of a caller-selected mode.
- [PostgreSQL camel-case tokenization recall gap](../database-issues/postgres-tsvector-camelcase-tokenization-recall-gap-20260502.md) records the shared joined-versus-separated brand normalization requirement.
- [Typesense Watch search payload projection latency](../performance-issues/typesense-watch-search-payload-projection-latency.md) defines the no-new-round-trip and measured-p95 guardrails.
- The implementation and rollout contract is recorded in `docs/plans/2026-08-12-001-fix-watch-search-title-brand-ranking-plan.md:14-23` and requires CURRENT/public to remain on legacy RRF until explicit operator promotion.
