---
id: "feat-475"
title: "Close recommendation translation coverage gaps"
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

Recommendations require a published translation under the exact requested transcript/display locale. Compatible embeddings and playable chosen audio alone cannot satisfy that rule. `feat-474` supplies reproducible diagnosis and a private prioritized cohort; this ticket owns the resulting translated-metadata coverage work.

## Approved Display Rule

If a translation is missing, do not show the card. The user explicitly rejected English text fallback. Keep published requested-locale text and the exact chosen audio as eligibility requirements. Generic `zh` must not silently choose a script; reconcile locale identities only where the actual requested translation can be established.

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

1. Prepare a bounded missing-translation synchronization/publication list through existing Core/Admin ownership. Distinguish absent source translations from translated metadata that exists upstream but was not synchronized or published. Rebuilding embeddings does not create those translations.
2. Repair only demonstrated synchronization, publication, or locale-identity defects for genuine requested translations. Keep semantic retrieval, profile candidates, hydration, and cache eligibility consistent: a missing or unpublished requested translation excludes the card even if English metadata is available. Preserve exact audio identity and distinguish transcript locale from display locale.
3. Make future empty-request diagnosis reproducible by retaining the requested audio identity in bounded request evidence, with existing retention/privacy rules. Plan a compatible migration for older rows; never backfill an inferred audio slug from a BCP-47 code.
4. Re-run fixed-window coverage and bounded retrieval after normal deployment. Keep usefulness evaluation dependent on valid playback/impression evidence rather than card counts alone.

## Constraints

Preserve exact audio identity, active embedding provenance, and non-deleted published translated content. Do not use English text fallback, create placeholder translations from English text to satisfy eligibility, infer historical audio, select an unapproved Chinese script, or trigger paid enrichment as a side effect. Respect existing Core versus Manager metadata ownership.

## Verification

Verify that missing or unpublished requested translations produce no card even when English metadata, compatible embeddings, and selected audio are present. Verify that publishing the genuine requested translation makes an otherwise eligible candidate available. Cover deleted/restricted content, Chinese script distinctions, same-BCP47 audio siblings, edition mismatch, and consistent cache/hydration/candidate evidence. Preserve the 1.5-second delivery budget and exact active embedding contract. Regenerate Admin GraphQL artifacts in the same PR if the schema changes.
