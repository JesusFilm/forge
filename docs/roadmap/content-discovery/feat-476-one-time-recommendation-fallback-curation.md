---
id: "feat-476"
title: "Curate one-time recommendation fallback pools"
owner: "nisal"
priority: "P1"
status: "in-progress"
start_date: "2026-09-10"
duration: 1
depends_on: []
blocks:
  - "feat-477"
tags:
  - "recommendations"
  - "content"
  - "i18n"
---

## Problem

The homepage For you row needs six unique recommendations in the selected audio language. Eligible profile recommendations take precedence; curated starter and interest pools fill only missing positions. Pool size must withstand overlap and viewing-history exclusions, but curation cannot manufacture missing inventory.

## Entry Points — Read These First

1. `docs/recommendations/curation/2026-09-10/`: versioned editorial manifest, source evidence, language coverage, and validation report.
2. `apps/admin/src/services/recommendations/eligibility.ts`: locale publication, exact audio slug, Watch visibility, playback, and image checks.
3. `apps/admin/src/services/core-sync/phases/sync-dubs.ts`: flat Core variant pagination and Core-to-Admin dub boundary.
4. `CONCEPTS.md`: Core ID, Video, Dub, Language, and Containing Work.

## Grep These

`nominationEligibilityReasons`, `audioLanguageSlug`, `canonicalIdentity`, `watchPlayable`, `restrictViewPlatforms`.

## What To Build

A one-time curation by the delegated Codex Astra agent: a versioned machine-readable editorial manifest using stable Core IDs, starter and a small set of content-theme fallback pools, exact-audio language materialization, and a reproducible coverage report. Resolve Admin IDs and validate current Admin eligibility when authorized access is available; otherwise retain draft status and document the precise missing evidence.

## Constraints

The later implementation authorization includes feat-477 U2: curated-pool tables/migration, service, import CLI, tests and isolated local preview activation. No production import, deployment, paid model API, recurring AI worker, or automated incremental AI review. Use canonical videos rather than dub counts as editorial units. Do not infer popularity from metadata or exposure-biased analytics. Interest labels describe content and do not diagnose viewers. Public Core availability is not Admin recommendation eligibility. Preserve history rules; surface any inventory exhaustion decision for product resolution.

## Verification

Validate unique IDs, pool references, exact-language joins, duplicate-work groups, provenance hashes, and reproducible per-language counts. Report languages with fewer than six distinct candidates, reserve depth, and pool overlap. Production completion requires current Admin ID resolution and publication, restrictions, playback, and artwork validation for the requested locale/audio combinations. Keep this ticket in progress until that coverage and validation are achieved.

## Current Result

The Core-only editorial pass is recorded in `docs/recommendations/curation/2026-09-10/coverage-report.md`: 208 editorial choices, 203 starter choices, five content-theme pools, and a reproducible exact-audio materializer. The later `admin-coverage-report.md` resolves all 233 Core references in the authorized local snapshot. Across 2,317 Admin audio slugs with UI locale `en`, 2,273 have at least thirty eligible curated starters, eight have six to twenty-nine, twenty-nine have one to five, and seven have zero. The entire catalog has fewer than six potentially eligible Admin IDs in thirty-five languages even before canonical dedup. Theme labels add no unique reserve beyond the starter union.

`2026-09-10.astra-admin-preview.v2` is active only in isolated `forge_feat477_20260910` for `en`/`english` (191 starters), `fr`/`french` (164), and `hi`/`hindi` (141). `ta`/`tamil` was rejected for missing published display locales. Migration `0083_recommendation_curated_pools`, `curated-pools.service.ts`, its tests, and `apps/admin/scripts/import-recommendation-pools.ts` implement immutable import, coverage-gated promotion, bounded current-eligibility hydration, and rollback. No production data was changed.

The subsequent `all-context-coverage-report.md` completes the local cross-product: **225 website locales × 2,317 audio languages = 521,325 contexts**. There are 47,901 contexts with six curated starters, 47,732 with thirty, and 5,723 with forty-four. The other 473,424 have fewer than six. Only twenty-one website locale keys match published display metadata; 202 have no published rows and `zh-Hans`/`zh-Hant` mismatch the catalog's lowercase keys. The separate translation-coverage work is tracked as feat-475 in the concurrent locale-coverage branch; preserve the exact requested translation rule.

Projecting that matrix through the actual Web homepage locale resolver gives
2,081 of 2,317 audio routes with six curated starters, 2,073 with thirty, and 185
with forty-four. Of the 236 routes below six, 200 map to a display locale without
matching published text. The report retains every per-language result, including
zeroes; these counts do not imply additional activated contexts.

`media-validation.md` records successful live checks of 233 English HLS manifests and 233 image links, covering every referenced Core cut. `editorial-review.md` completes individual metadata reviews for all eleven flagged choices; their exclusions remain and add no active inventory.

This ticket remains in progress because the measured translation/inventory gaps are unresolved and current production publication/restrictions have not been revalidated. Current production credentials were unavailable during this exhaustive pass; the former temporary Railway/database credential files are absent. The report is explicitly local snapshot evidence. A manifest check is not full playback of every dub. Default six plus twenty-four exclusions requires thirty eligible choices; count twenty needs forty-four. The API must not infer broad readiness from the three passing preview scopes.

The user-requested fresh `videoVariants` check is recorded in
`docs/recommendations/curation/2026-09-10/video-variants-cross-check.md`. All 200
display-blocked languages have 48–568 published leaf videos with playback data;
the same selected audio supports 31–152 curated candidates under English display
in the existing local audit. This isolates the display rule without enabling
English fallback. Thirty-four of the 35 small-inventory contexts also have fewer
than six such videos in fresh Core. Persian Sign Language has 62 HLS declarations,
all already synchronized locally, but 61 chapter variants lack Mux playback IDs
and their `arc.gt` links fail with redirect errors; only the full-film manifest
passes. Repair and verify those stream targets before considering eligibility for
HLS-only media. Raw published variant counts include collection entries and must
not be treated as playable-video counts.

The requested delegated PG catalog reconstruction is complete in
`docs/recommendations/curation/2026-09-10/pg-catalog-summary.json` and the adjacent
`pg-catalog-*.csv` maps. It retains all 1,175 videos, 212,171 dubs and 2,321 language
rows across 15 inspected tables before applying delivery filters. All 208 choices
and 233 referenced cuts resolve; 834 additional leaf video records have published
source metadata somewhere in the catalog and remain unreviewed. The map preserves
478 dubs with null language links, exact localized records, optional HLS/Mux
sources, collections/series, editions, keywords and parent-child relations.
Independent controls verify every raw export, normalized dub identity, editorial
reference, aggregate count and prior eligibility join. Six source-label differences
against cached fresh Core responses are recorded separately. This completes the
inventory reconstruction, not production activation or a new curation generation;
the existing unresolved display/source and reserve decisions remain visible.
