---
title: Watch Search Candidate Title-and-Brand Ranking
type: fix
date: 2026-08-12
topic: watch-search-title-brand-ranking
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Watch Search Candidate Title-and-Brand Ranking

## Goal

Test the automatic Title-and-brand/Semantic ranking through the existing physical
CANDIDATE profile and existing Admin CURRENT-versus-CANDIDATE comparison. Keep
CURRENT/public Watch on legacy RRF until an operator explicitly promotes a
qualified candidate.

This work may change application code, tests, diagnostics, and documentation,
then open and merge a PR. It may not deploy, create or rebuild production
collections, move aliases, change Railway variables, or promote the candidate.

## Diagnostic conclusion

- PR #1859's native three-lane RRF weights title at 0.56, metadata at 0.14, and
  semantic transcripts at 0.30 with k=60.
- A rank-one semantic-only result contributes 0.30/61, while a rank-one
  metadata-only result contributes 0.14/61. The semantic result therefore gets
  about 2.14 times the metadata contribution.
- This reproduces the reported shape: an exact BibleProject collection can lead
  through the title lane while unrelated semantic transcripts outrank related
  BibleProject metadata results.
- PR #1867 changed transcript projection completeness by adding
  `videoEditionId`. CURRENT may use compatibility fallback for missing
  projection fields; schema-complete Candidate generations use native fusion.
- Retained production logs, the deleted previous physical generation, exact old
  alias bindings, and old document counts were unavailable. Therefore the
  reindex ending compatibility fallback remains plausible but is not proven as
  the exact production trigger.
- The fix targets the directly reproduced native-ranking defect. It does not
  change documents, embeddings, visibility filters, schemas, tokenizers, HNSW
  settings, aliases, or imports.

## Product behavior

The CANDIDATE policy automatically selects one of two final-ranking modes after
the existing bounded hybrid retrieval:

1. **Title-and-brand mode** activates only when the title lane establishes a
   strong normalized title, brand, series, or collection anchor.
2. **Semantic mode** is used when no strong anchor exists and preserves normal
   transcript-semantic discovery.

Title-and-brand mode recognizes case, punctuation, joined/separated forms,
leading articles, and generic collection suffixes. It orders whole-title,
unique title-core, related-title, and precise metadata evidence before unrelated
semantic fill. It is general and contains no BibleProject-specific rule.

## Architecture

- CURRENT profile: existing legacy RRF, including compatibility fallback.
- CANDIDATE profile: existing schema-complete native retrieval plus the new
  automatic ranking.
- Comparison: existing private Admin comparison freezes CURRENT, resolves the
  EVALUATION candidate generation, and runs the same query on both profiles.
- Storage: Candidate continues to own separate catalog, availability, and
  lexical collections and share the current transcript collection.
- Promotion: existing qualification and SERVING pointer/profile mechanism,
  performed later only with explicit operator approval.

No public input toggle, LLM classifier, additional network round trip,
additional Typesense multi-search call, or additional logical subsearch is
introduced.

## Requirements

- CURRENT/public result ordering and fallback behavior remain unchanged.
- CANDIDATE title/brand queries prefer the matched content family before
  unrelated semantic-only results.
- Conceptual queries such as `hope after divorce`, `I feel alone`, and
  forgiveness/anxiety questions retain semantic ordering.
- Joined and separated brands, leading articles, collection titles,
  metadata-only brand matches, multilingual titles, mixed evidence, canonical
  grouping, watchability, pagination, and stable ties receive regression tests.
- Diagnostics identify the ranking implementation and mode and record bounded
  per-result title, metadata, and semantic lane evidence.
- Candidate p95 must be no higher than CURRENT p95 for end-to-end, Typesense
  wall, and Typesense server search time. Whole-search end-to-end must remain
  below one second.
- Promotion fails closed if relevance, latency, identity, or completeness
  evidence is absent.

## Implementation units

### U1. Candidate-only ranking

Add deterministic normalization, anchor selection, evidence tiers, and stable
ordering. Derive policy strictly from profile identity: CURRENT is
`legacy-rrf`; CANDIDATE is `title-and-brand-v1`.

### U2. Existing comparison diagnostics

Carry bounded lane contributions, fused score, canonical identity, selected
watchability, and final rank through the existing comparison response. Redact
normalized query material from the privacy-safe comparison projection.

### U3. Verification and landing

Run focused and full Admin tests, typecheck, lint, existing candidate relevance
evaluation, latency qualification where its dependencies are available, and
browser verification of the existing Admin comparison. Formally review and
compound the solution. Open, validate, and merge the PR without deploying or
promoting.

## Acceptance examples

- `the bible project`, `Bible Project`, `BibleProject`, and
  `BibleProject Collection` enter Title-and-brand mode in CANDIDATE when a
  matching title-lane anchor exists.
- The collection and related title/metadata results precede an unrelated
  semantic-only result in CANDIDATE.
- The same fixture in CURRENT preserves the legacy ordering.
- `hope after divorce` remains Semantic mode and retains fused semantic order.
- Candidate and Current retain the same number of retrieval calls and logical
  subsearches for the same query.
- Missing deployed evaluation or p95 evidence blocks promotion, not the
  private candidate code PR.
