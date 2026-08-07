---
title: "Project localized subtitle evidence before bounded fallback"
date: "2026-08-07"
category: "logic-errors"
module: "admin-watch-search"
problem_type: "logic_error"
component: "service_object"
severity: "high"
symptoms:
  - "Localized subtitle chunks stayed private when the video had no same-language title row."
  - "Non-English Watch queries returned no results for playable videos whose indexed search evidence was English-only."
  - "Romanian title spellings Isus and Iisus did not retrieve the canonical JESUS title."
root_cause: "logic_error"
resolution_type: "code_fix"
related_components:
  - "typesense-watch-search"
  - "watch-search-query-normalization"
tags:
  - "watch-search"
  - "romanian"
  - "cross-language-evidence"
  - "typesense"
  - "multilingual-search"
  - "pagination"
---

# Project localized subtitle evidence before bounded fallback

## Problem

Native localized subtitle evidence and localized display metadata are separate
contracts. A public, playable video can have a Romanian subtitle transcript
while retaining only an English display title. The transcript projection
incorrectly required a published same-language `VideoLocale`, so exact Romanian
subtitle chunks stayed private.

Some inventory genuinely has no localized searchable evidence. That separate
case needs bounded English candidate recovery without allowing an English-only
video into a target-language result.

FGE-3 exposed the defect through Romanian inventory. GitHub PR #1736 changes
`watch-search.service.ts`; the current serving path and the underlying defect
are in `typesense-watch-search.service.ts`.

## Symptoms

- Spanish and Hindi targets reproduced the same empty result when a playable
  video had only English lexical evidence. The cross-language regression matrix
  is in `apps/admin/src/services/typesense-watch-search.service.test.ts`.
- A live Romanian subtitle transcript with an English-only display locale was
  excluded by `publiclyVisible` despite exact persisted subtitle provenance.
- `JESUS`, `Isus`, and `Iisus` missed a Romanian-playable video when the title
  was present only in the English lexical projection.
- Romanian topic queries with English transcript evidence could return no
  result even when a relevant Romanian-audio video existed. The reported query
  matrix is covered in
  `apps/admin/src/services/typesense-watch-search.service.test.ts`.
- Stronger English-only groups could consume the result window before a later
  Romanian-playable group was checked. The page-boundary and non-zero-offset
  regression is also covered in that service test.

## What Didn't Work

- The FGE-3 investigation showed that searching only the target evidence locale
  could not retrieve English-only evidence. Spanish and Hindi counterexamples
  proved this was not Romanian-specific.
- Regression counterexamples showed that treating English as ordinary evidence
  admitted English-only inventory into a Romanian-target result.
- A page-boundary regression showed that filtering English fallback candidates
  after `offset` and `limit` slicing could produce sparse or empty pages.
- A grouped-ranking regression showed that adding title variants without
  per-lane accounting could inflate one candidate's score.
- A degraded-path regression showed that the selected display locale could not
  safely stand in for the locale that supplied matching evidence.

## Solution

The primary path is native localized subtitle evidence. A subtitle-backed
transcript may be public independently of title localization only when its
persisted `source_kind`, subtitle ID, exact Forge language ID, transcript
language, edition, and video match a current non-deleted subtitle, joined live
language/BCP-47, edition, and dub binding with VTT or SRT. The persisted source
language slug remains useful audit provenance, but it is not a visibility
predicate. The video must still be non-deleted, indexable, and have at least
one published display locale. Invalid or private chunks stay in the broad
corpus with `publiclyVisible:false`; public retrieval continues to require
`publiclyVisible:=true`.

The secondary path is candidate-level recovery. For every non-English target,
English is an evidence locale marked `fallbackOnly`, including when English is
already an explicit query signal. English-native searches do not add fallback
lanes. The title, metadata, and semantic lanes carry the fallback provenance
into their candidates in `apps/admin/src/services/typesense-watch-search.service.ts`.

Fallback-only candidates pass eligibility only when indexed availability
resolves to `target_audio` or `target_subtitle`. When any fallback-only
candidate is present, the service hydrates the bounded fused candidate set,
applies eligibility, and only then slices the page. The degraded catalog path
conservatively marks lexical candidates as fallback-only whenever
cross-language fallback evidence is active. Fusion also preserves native
snippet and language provenance if the same candidate later matches an English
fallback lane.

The only Romanian-specific behavior is spelling normalization: `Isus` and
`Iisus` add a deduplicated canonical `JESUS` title query in
`apps/admin/src/services/watch-search-query-normalization.ts`. Retrieval
deduplicates equivalent lane requests, while fusion retains only the best
contribution from each logical lane for both the canonical group and each group
member.

Deep offsets retrieve each lexical lane's complete page prefix through
`offset + limit + 1`, using at most 250 groups per Typesense page. The service
batches those requests through `multiSearchInBatches`, never sending more than
50 subsearches in one `/multi_search` call. It fuses and deduplicates that
bounded prefix, applies target playability, and slices only afterward.

## Why This Works

The result now has three independent decisions:

1. Exact live subtitle provenance decides whether native localized transcript
   evidence is publicly searchable; title language does not.
2. Evidence role decides whether a candidate is native or fallback recovery.
3. Target watchability decides whether fallback evidence may produce a result.

Carrying provenance until the availability decision prevents display locale,
query language, and playback language from being conflated. Running the
eligibility gate before the Search Candidate Window is sliced prevents an
ineligible English-only group from hiding a later target-playable group.

The design stays bounded. Candidate retrieval retains the existing cap in
`apps/admin/src/services/typesense-watch-search.service.ts`. Lexical page-prefix
and optional semantic requests stay ordered but may span multiple Typesense
multi-search calls, each capped at 50 subsearches. Result hydration deduplicates
and batches IDs.

## Prevention

- Treat cross-language evidence as explicit provenance, not as normal native
  evidence.
- Prove subtitle visibility from exact stored source identity and current
  edition/video/language availability. Never infer Forge language identity from
  BCP-47 alone, and never let a title row stand in for subtitle provenance.
- Preserve the public video baseline and keep failed provenance/private sources
  in the broad corpus as `publiclyVisible:false`.
- Apply every result-eligibility gate before pagination or candidate-window
  truncation.
- Test the positive and negative halves together: target audio, target
  subtitles, and a more relevant non-target-playable result.
- Include representative targets outside the reported locale and an unchanged
  English-native control whenever a language-specific report exposes a shared
  retrieval path.
- Add page-boundary and non-zero-offset regressions whenever retrieval lanes or
  eligibility rules change.
- Cap both group-level and member-level contributions when multiple requests
  represent one logical ranking lane.
- Keep degraded paths conservative when match-level evidence provenance is not
  available.
- Treat subtitle provenance, deletion, availability, and visibility-policy
  changes as transcript-projection rebuild events until incremental refresh
  exists. Reuse healthy vectors; audit every edition selected by each core ID
  and language command scope, run `force` only when those editions share that
  category, and never use language-wide `force`.

## Related Issues

- [Canonical language boundaries and lexicographic search ranking](./canonical-language-boundaries-and-lexicographic-search-ranking.md)
- [Typesense Watch search payload projection latency](../performance-issues/typesense-watch-search-payload-projection-latency.md)
- [Precomputed hybrid search serving index](../best-practices/precomputed-hybrid-search-serving-index-20260803.md)
- [Watch search overlay page-size mismatch](./watch-search-overlay-page-size-mismatch.md)
- Linear FGE-3 (Romanian report)
- GitHub PR #1736, open approach for the non-Typesense service
