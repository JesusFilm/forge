---
id: "feat-474"
title: "Diagnose recommendation locale and source coverage"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-09-10"
duration: 3
depends_on: []
blocks:
  - "feat-475"
tags:
  - "recommendations"
  - "watch"
  - "analytics"
---

## Problem

Authorized production analysis identified requested locales with no card-returning results. The retrieval timeout repair is now deployed, so coverage must be remeasured before attributing remaining failures to missing sources, contract exclusion, locale mapping, or candidate/playability filtering. This ticket succeeds the unpublished coverage draft numbered feat-471, whose ID is now used by a RAG ticket. Production usage aggregates remain in gitignored local artifacts.

## Entry Points — Read These First

1. `docs/operations/recommendation-locale-coverage.md` — reproducible read-only coverage investigation (created by this work); private cohort artifacts remain under `.tmp/recommendation-locale-coverage/`.
2. `apps/admin/src/services/recommendations/delivery-retriever.ts` — seed, nearest, display-locale, and exact-audio-dub filters.
3. `apps/admin/src/services/content-embedding-contract.ts` — active-contract identity.
4. `docs/roadmap/content-discovery/feat-199-transcript-embedding-operations-promotion.md` — owner of durable backfill/source-coverage operator work.
5. `docs/solutions/best-practices/language-identity-on-slug-not-bcp47-20260605.md` — language identity distinctions.

## Grep These

`no_candidates`, `seed_embedding_unavailable`, `language_slug`, `audioLanguageSlug`, `activeTranscriptContentEmbeddingWhere`, `dub_without_timed_text`.

## What To Build

- For the high-demand failing locale/source pairs, count each stage separately: seed transcript, active-contract seed chunks, candidate transcripts, published display locale, exact playable audio dub, and final eligibility/deduplication.
- Distinguish absent source material, incomplete ingest/embedding, contract mismatch, locale identity errors, and retrieval/candidate-window failures. Preserve counts and reproducible read-only SQL.
- Implement only verified recommendation mapping/eligibility defects here, with positive and negative fixtures. Route genuine source/enrichment/backfill remediation to `feat-199`, supplying a bounded prioritized target list; do not duplicate that operator platform.
- Establish a recurring aggregate coverage breakdown by requested locale/source, with explicit denominators and small-sample caveats, using existing Admin evidence where possible.

## Constraints

Do not weaken contract or watchability checks, substitute a wrong audio language, silently reinterpret BCP-47 as an exact language identity, or launch automatic paid enrichment/full-library re-embedding. `feat-199` is related work, not a hard prerequisite until diagnosis demonstrates it is required. Keep generation operations in their existing owner.

## Verification

Reconcile the staged counts with the recorded request reasons. Verify exact-language playable results for repaired cases and empty results for legitimately unsupported cases. Test active/inactive contract, missing transcript, locale aliases, unpublished/restricted content, and nearest-neighbor filtering. Run focused tests/lint/typecheck for the code actually changed. Re-measure coverage after normal deployment.

## Diagnosis Handoff

Reusable read-only inventory and fixed-window cohort tools are implemented. Verified missing seed transcripts route to `feat-199`; missing translations and locale-identity reconciliation route to `feat-475`. The user confirmed that missing translations must exclude the card; English fallback is not permitted. No source data is changed by this diagnostic slice. The private report and bounded source target list live under `.tmp/recommendation-locale-coverage/`. A replay with known audio is not a reconstruction of historical empty requests whose audio was not persisted.

## Validation

Admin unit suite, typecheck, and lint passed. Focused fixtures validate exact language/edition identity, publication, active parent/chunk provenance, missing sources, and read-only settings. The cohort SQL passed real `psql` interval/denominator checks. Both operator tools were executed read-only against production; usage results remain private. Serving remediation remains in the follow-up tickets above.
