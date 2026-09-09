---
title: Separate recommendation text, audio, and embedding coverage
module: "Admin Recommendations"
date: "2026-09-10"
problem_type: "best_practice"
component: "service_object"
severity: "medium"
applies_when:
  - "Recommendations are empty despite compatible transcript embeddings"
  - "Investigating locale coverage or planning source backfills"
tags:
  - "recommendations"
  - "locale"
  - "language-identity"
  - "embeddings"
  - "coverage"
---

# Separate recommendation text, audio, and embedding coverage

## Context

Recommendation delivery combines a transcript/display locale, an exact audio slug, and an active embedding contract. An empty result can come from different stages. A catalog can have playable translated audio and compatible transcript vectors while lacking published metadata under the requested locale.

## Guidance

Use `docs/operations/recommendation-locale-coverage.md` to audit an explicit `(seedMediaId, locale, audioLanguageSlug)` tuple. Inspect seed sources and chunks, candidate sources and chunks, watchability, publication, and same-edition exact audio independently. Use the shared active-contract predicate, including parent provenance and chunk model/dimension/language compatibility.

Keep three boundaries explicit:

- Metadata: `VideoLocale.locale` must satisfy the current publication policy. Availability under `zh-hans` or `zh-hant` does not automatically satisfy generic `zh`. Synchronizing localized text and generating embeddings have different owners.
- Audio: match `Language.slug` and the transcript edition. BCP-47 may be shared by multiple audio language identities; it cannot select a replacement dub.
- Retrieval: eligible inventory exists before the bounded ANN window, deduplication, recent-item suppression, and delivery. A positive inventory count does not guarantee cards.

Existing empty request rows lack requested audio identity. Preserve explicit replay audio as an audit assumption; never claim it was reconstructed from the recorded locale. Report request and session denominators separately from current inventory, and do not equate card coverage with usefulness.

## Why This Matters

Re-embedding compatible transcript rows does not create missing published text. Relaxing only retrieval's publication join can conflict with hydration, profile candidates, and cache eligibility. Missing timed text instead belongs to the existing source workflow: Core subtitles first, Manager artifacts second, with paid enrichment considered separately.

## Verification and Examples

The diagnostic database tests use synthetic fixtures for missing metadata, alternative Chinese script labels, sibling audio slugs sharing BCP-47, mismatched editions, incompatible contract provenance, missing chunks, and deleted/restricted content. Production observations remain in gitignored reports; this guidance records the diagnostic method without usage data.

For a synthetic `te` / `telugu` input with valid vectors and playable audio but no published `te` metadata, expect `published_metadata_missing`. That is a metadata or display-policy handoff. If the same seed has no `te` transcript row, expect an independent `seed_transcript_missing` source handoff as well.

## Related

- [Language identity uses slug, not BCP-47](language-identity-on-slug-not-bcp47-20260605.md)
- [Bounded semantic retrieval](../performance-issues/semantic-recommendation-retrieval-bounded-pgvector-fanout.md)
- [Coverage runbook](../../operations/recommendation-locale-coverage.md)
- [Display policy follow-up](../../roadmap/content-discovery/feat-475-recommendation-display-locale-policy.md)
- [Source operator ownership](../../roadmap/content-discovery/feat-199-transcript-embedding-operations-promotion.md)
