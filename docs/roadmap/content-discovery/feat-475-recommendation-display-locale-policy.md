---
id: "feat-475"
title: "Resolve recommendation display locale coverage policy"
owner: "nisal"
priority: "P1"
status: "not-started"
start_date: "2026-09-10"
duration: 3
depends_on:
  - "feat-474"
blocks: []
tags:
  - "recommendations"
  - "watch"
  - "localization"
---

## Problem

Recommendations require published card metadata under the exact requested transcript/display locale. Compatible embeddings and playable chosen audio alone cannot satisfy that rule. Missing text and alternative Chinese script labels need an explicit policy before changing serving behavior. `feat-474` supplies reproducible diagnosis and a private prioritized cohort; this ticket owns the resulting display-policy work.

## Decision Required

Choose whether missing translated card text may fall back to English while preserving the exact chosen audio, or whether content must continue to wait for published requested-locale text. Separately define acceptable Chinese script selection; generic `zh` must not silently choose a script. No fallback policy has been approved by this ticket.

## Entry Points — Read These First

- `docs/operations/recommendation-locale-coverage.md` — diagnosis, input identity, denominator limitations, and source handoff.
- `apps/admin/src/services/recommendations/delivery-retriever.ts` — transcript locale, display row, and same-edition audio selection.
- `apps/admin/src/services/recommendations/candidate.ts` and `apps/admin/src/services/recommendations/candidates/` — candidate identity and eligibility contracts.
- `apps/admin/src/services/recommendations/delivery.service.ts` — orchestration and request evidence.
- `apps/admin/src/services/core-sync/video-localized-metadata.ts` — localized text ownership and publication.
- `apps/web/src/lib/locale.ts` — existing locale/audio mappings; inspect semantics without importing across apps.
- `apps/admin/prisma/schema.prisma` — `RecommendationRequest` does not persist requested audio for empty results.

## Grep These

`display_locale`, `vl_visible`, `audioLanguageSlug`, `candidateEligibilityParity`, `RecommendationRequest`, `published`.

## What To Build

1. Record the display policy. If exact requested-locale publication remains required, prepare a bounded missing-text synchronization/publication list through existing Core/Admin ownership rather than rebuilding embeddings.
2. If fallback is approved, distinguish transcript locale, display locale, and exact audio slug explicitly. Align semantic retrieval, profile candidates, hydration, publication checks, response/cache identity, and candidate evidence. Avoid a one-join fallback that later fails eligibility or returns mismatched text/audio.
3. Make future empty-request diagnosis reproducible by retaining the requested audio identity in bounded request evidence, with existing retention/privacy rules. Plan a compatible migration for older rows; never backfill an inferred audio slug from a BCP-47 code.
4. Re-run fixed-window coverage and bounded retrieval after normal deployment. Keep usefulness evaluation dependent on valid playback/impression evidence rather than card counts alone.

## Constraints

Preserve exact audio identity, active embedding provenance, and non-deleted published content. Do not infer historical audio, select an unapproved Chinese script, or trigger paid enrichment as a side effect. Respect existing Core versus Manager metadata ownership.

## Verification

Cover missing and unpublished translations, exact publication taking precedence over fallback, deleted/restricted content, Chinese script distinctions, same-BCP47 audio siblings, edition mismatch, and consistent cache/hydration/candidate evidence. Preserve the 1.5-second delivery budget and exact active embedding contract. Regenerate Admin GraphQL artifacts in the same PR if the schema changes.
