---
id: "feat-361"
title: "Add multilingual morphology and taxonomy Watch suggestions"
owner: "urim"
priority: "P1"
status: "complete"
start_date: "2026-08-13"
completed_date: "2026-08-13"
duration: 2
depends_on:
  - "feat-337"
  - "feat-352"
blocks:
  - "feat-362"
tags:
  - "admin"
  - "watch"
  - "search"
  - "typesense"
  - "i18n"
---

## Problem

Watch suggestions use literal prefix matching over localized title and metadata
fields. Production therefore returns no suggestions for ordinary grammatical
variants such as English `shorts` when the indexed vocabulary contains `short`,
and category-shaped queries cannot retrieve content unless the category text is
already present in a title or description. The same gap affects other languages
and must not be solved with an English-only rewrite table.

## Entry Points - Read These First

1. `docs/plans/2026-08-13-1954-multilingual-watch-suggestion-recall-plan.md`
2. `apps/admin/src/services/typesense-watch-search-suggestions.ts`
3. `apps/admin/src/services/typesense-watch-search-lexical.ts`
4. `apps/admin/src/services/typesense-watch-search-schema.ts`
5. `apps/admin/src/services/typesense-watch-search-indexer.ts`
6. `apps/admin/src/services/typesense-watch-search-locales.ts`
7. `apps/admin/src/services/typesense-client.ts`

## Grep These

```bash
rg -n "watchSearchSuggestions|phraseWindows|matchTier|matchingValue" apps/admin/src/services
rg -n "watch_search_lexical|languageIdentity|metadata_fallback|TYPESENSE_WATCH_SEARCH_CANDIDATE_APPLICATION_REVISION" apps/admin/src/services
rg -n "model Keyword|model VideoKeyword|keywords:" apps/admin/prisma apps/admin/src/services
```

## What To Build

1. Preserve literal title and metadata fields, then add separate locale-selected
   morphology recall fields so exact prefix evidence remains rankable above
   analyzer expansion and proper names are not silently rewritten.
2. Project language-bound Core keywords into separate taxonomy fields keyed by
   exact public language slug. Add a reviewed, Admin-owned category alias only
   when the frozen corpus proves Core lacks a required structural term. Use
   BCP-47 only to select a tokenizer; never use it as document identity or
   automatically share category vocabulary between public languages.
3. Retrieve baseline and expanded candidates as bounded lanes, retain Typesense
   match-field provenance, and merge deterministically by explicit match class.
   Expanded hits must not be discarded by the current raw-prefix post-filter.
4. Generate visible query phrases only from literal localized title/description
   evidence. Keep the current bounded Unicode tokenization, but apply the English
   edge-stop-word list only to the English analyzer. Script-aware phrase
   segmentation is tracked separately in `feat-362`.
5. Keep phrase validation, direct-match hydration, exact language filtering,
   canonical-video deduplication, visible caps, and explicit full-search submit
   behavior intact. Expanded-lane failure must degrade to baseline suggestions.
6. Qualify the changed projection as a new immutable lexical collection
   revision. After qualification, let the existing current-index publisher build
   the matching serving generation and atomically publish the coordinated aliases.

## Constraints

- No English-only query rewrites and no English taxonomy fallback for a selected
  non-English language.
- Do not conflate the public `Language.slug`, tokenizer locale, and playback
  language.
- Do not add semantic, transcript, history, popularity, personalization, or
  submitted-search analytics work to the typing path.
- Do not change the GraphQL or Web contracts, full Watch search ranking, or the
  Enter/Search explicit-submission path.
- Keep the existing maximum of 25 lexical candidates, six query suggestions,
  six direct matches, bounded phrase-validation deadline, and optional fail-soft
  suggestion behavior.
- Do not import Web UI translation catalogs into Admin indexing. Taxonomy data
  must come from Core language-bound keywords or reviewed Admin-owned data.

## Verification

- Schema, lexical projection, indexer, client, and suggestion service tests cover
  regular and irregular morphology, localized taxonomy terms, diacritics,
  apostrophes and hyphens, RTL text, unsupported analyzers, proper-name negative
  controls, exact-slug collision isolation, and language-scoped stop-word rules.
- Production-shaped fixtures prove English `shorts` returns relevant short-film
  content and representative non-English grammatical/category queries return
  only content from the selected public language.
- Request-shape tests prove fixed caps, deterministic tier ordering, canonical ID
  deduplication, expansion degradation, and no sequential per-phrase requests.
- Candidate generation creates a fresh application revision, passes import and
  manifest validation, and qualifies the frozen multilingual corpus before the
  current-index publisher may build and publish that serving revision.
- Focused Admin tests, typecheck, lint, format checks, and a Watch modal browser
  smoke pass without changing Web behavior or page-loading performance.

## Completion Evidence — 2026-08-13

- Local Admin verification passed for immutable candidate validation, exact
  language identity isolation, candidate-bound suggestion requests, the exact
  v2 qualification guard on the current publisher, and pure latency, request,
  and capacity gates.
- Focused Admin tests, typecheck, lint, formatting, and diff checks passed. No
  serving alias was moved and no external Typesense or database state changed.
- The credentialed production candidate benchmark and post-alias Watch smoke
  remain deployment gates. They were not run locally and must pass through the
  normal PR-to-main publication flow before production promotion.
