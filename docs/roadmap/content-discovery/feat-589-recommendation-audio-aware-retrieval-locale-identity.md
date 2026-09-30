---
id: "feat-589"
title: "Repair recommendation audio-aware retrieval and locale identity"
owner: "nisal"
priority: "P1"
status: "complete"
start_date: "2026-10-01"
duration: 5
depends_on: []
blocks: []
tags: [admin, web, recommendations, i18n, pgvector, reliability]
---

## Problem

The October 1 read-only diagnosis reproduces two delivery failures against deployed source and production catalog data. Exact-audio eligibility runs after the 48-neighbor-per-seed limit: Birth of Jesus/Gbii returns one candidate, versus 36 when the same audio requirement is applied before the limit. The Beginning/Kwanyama reproduces two versus 36. Separately, Mandarin retrieval uses `zh` for both transcripts and presentation, while published text is under `zh-hans`/`zh-hant`; resolving only the display identity yields zero versus 36 candidates. These are candidate counts, not full-service performance or final-card acceptance.

## Entry Points — Read These First

1. `docs/reports/2026-10-01-recommendation-delivery/report.md` and adjacent SQL/JSON — reconciled 930 empty and 395 partial requests, reproduction and limits.
2. `apps/admin/src/services/recommendations/delivery-retriever.ts` and `delivery-retriever.db.test.ts` — bounded ANN, exact-dub and display joins.
3. `apps/admin/src/services/recommendations/delivery.service.ts`, `candidate.ts`, `delivery.types.ts`, `delivery-runtime.ts` — context, cache identity, complete-service deadline, persistence and fallback.
4. `apps/web/src/lib/locale.ts`, `components/watch/WatchSectionRenderer.tsx`, `components/recommendations/WatchSemanticRecommendations.tsx`, and Admin `graphql/queries/recommendation-delivery.ts` — UI/transcript/presentation/audio identity flow.
5. `apps/admin/prisma/schema.prisma` and `services/recommendations/admin-ops/` — request-level diagnostic context without exposing viewer identity.

## Grep These

`DELIVERY_NEIGHBORS_PER_SEED|nearest_chunks|eligible_chunks|audioLanguageSlug|vl_display.locale|resolveWatchLocaleIdentity|selected.length === 0|seed_embedding_unavailable`.

## What To Build

- Make bounded candidate selection aware of exact playable audio before exhausting its neighbor budget. Preserve current source/parent/child exclusions, active embedding contract and immutable final eligibility checks.
- Resolve transcript and display locale identities explicitly, including Chinese script selection. Establish the presentation fallback policy before changing publication semantics; preserve exact requested audio, consistent cache keys and public contracts.
- Retain bounded requested audio and stage-specific shortfall evidence for empty results; the current request ledger cannot distinguish the 246 English-locale empties by audio.
- Keep curated language expansion with main's feat-497 and transcript-source operations with feat-199. A partial-row curated top-up is a separate policy decision; this ticket does not implicitly authorize inventory publication or broader rollout.

## Constraints

No production mutation, generated embeddings, new model spend, silent audio substitution, relaxed publication checks or manual deployment. Preserve the 1.5-second complete-service deadline and player availability. The diagnostic audio-prefilter SQL is an experimental read, not a qualified implementation. No blanket claim that all empty rows are defects or that every requested context can supply six unique videos.

## Verification

- Real PostgreSQL fixture: nearest neighbors lack the requested audio, while at least six farther exact-audio eligible videos exist. Verify full distinct delivery without wrong-audio cards and preserve zero/partial results when catalog supply is genuinely insufficient.
- Locale fixtures: `zh` transcript with `zh-hans`/`zh-hant` display, explicit script choice, unavailable translation, inactive contract, source/parent/child exclusion and unpublished/unplayable dub.
- Verify empty-request context and diagnostic reconciliation without viewer identifiers; handle packed and legacy item snapshots.
- Measure full-service cold/warm and concurrent retrieval, hydration, deduplication, signing and persistence on representative multilingual data within the existing deadline. Count candidate improvement separately from final served cards.
- Run affected Admin/Web tests, lint, typecheck, format and appropriate browser/page-load checks. Regenerate Admin SDL and typed client only if the GraphQL contract changes. Use normal PR-to-main deployment and a bounded natural production recheck.

## Resolution

Exact playable audio is materialized once and checked before ANN limiting; published text uses the resolved presentation identity while Chinese transcripts remain `zh`. The owner approved Simplified for generic `zh`; explicit Traditional remains exact. Empty requests retain bounded context and stage evidence, and Web no longer replaces Admin receipts with ineligible legacy recovery. The 1,500 ms deadline is unchanged.

All 55 service deliveries across 11 historical snapshot contexts passed in 210–1,183 ms; full JESUS/Gbii remains two cards. Scoped Admin PostgreSQL/unit suites, Web tests, typechecks and browser checks are documented in `docs/reports/2026-10-01-recommendation-delivery/implementation-verification.md`. No production deployment or inventory expansion occurred. Partial-row top-up remains a separate unanswered decision. Feat-590 records stale unrelated integration fixtures discovered during validation.
