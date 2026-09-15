---
title: Recommendation locale coverage
date: 2026-09-10
status: completed
---

## Scope

Follow `docs/roadmap/content-discovery/feat-474-recommendation-locale-and-source-coverage.md`. Remeasure empty recommendation delivery after the retrieval repair, explain the highest-demand failing locale/source pairs, and repair only demonstrated defects within the existing publication, embedding-contract, and exact-audio rules.

## Requirements

- R1: Separate request demand and recorded outcomes from current content inventory; retain fixed cohort bounds and explicit denominators. Aggregate viewer/session identifiers in the database.
- R2: Trace seed transcript, active seed chunks, other candidate transcripts, active candidate chunks, publication, compatible-edition exact audio, and final serving independently. Distinguish possible inventory from the bounded nearest-neighbor result.
- R3: Preserve the 1.5-second delivery budget, exact active contract, direct-family exclusions, and chosen audio identity. Locale tags must not become audio identities.
- R4: Require a published translation in the requested locale. If that translation is missing, omit the card even when English metadata and the chosen audio exist. Preserve exact chosen audio. Missing translated metadata is not evidence that embeddings need regeneration.
- R5: Deliver reusable read-only diagnostics and a bounded source/policy follow-up where no permitted runtime repair is established. Keep usage artifacts gitignored; publish only sanitized engineering findings.

## Decisions

Start from current main in a dedicated worktree. Reuse Admin SQL/provenance helpers and existing operational conventions. Do not duplicate evidence-transport, profile evaluation, or embedding-operator work.

## Approved display rule

The user confirmed that a card must not be shown when its translation is missing. English text fallback is excluded. Coverage improvements must come from genuine requested-locale translations and compatible sources, with the same publication rule applied throughout retrieval, hydration, and candidate eligibility.
