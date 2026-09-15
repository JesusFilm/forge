# RAG migration recovery record

Date: 2026-09-04

This record reconciles the migration programme rooted at
[`JesusFilm/jesusfilm-rag#130`](https://github.com/JesusFilm/jesusfilm-rag/issues/130).
It distinguishes recovered repository contracts from historical production
proof that cannot be recreated after the fact.

## Recovered in feat-452

- Durable source and slice records, including the GotQuestions English-first
  decision, deferred multilingual batches, and null-language investigation.
- Referential-integrity validation for lifecycle records and documentation
  paths used as agent resume contracts.
- A reconciled source map aligned with the migrated registry and status ledger.
- A Forge-native source-scoped raw-document promotion workflow for validated,
  metered acquisitions.
- A Forge-local architecture authority and decision provenance map for ADRs
  still cited by code and tests.

## Existing implementation evidence

- `feat-428` records the deployed HTTP service and an inconclusive positive
  source-scope probe against an empty database. Unit and service tests preserve
  the authorization mechanism, but the historical positive production result
  is not claimed.
- `feat-429` and `feat-430` contain local and production corpus reconciliation
  receipts. The production copy receipt records retrieval equivalence inside
  its migration harness; it is not represented as a later authenticated
  legacy-versus-Forge `/v1` comparison.
- `feat-432` contains the prepared dashboard publication receipt. Publication
  and quality-comparison claims remain limited to what that receipt actually
  records.
- `feat-434` records the Seeker cutover. It is not rewritten to claim a timed
  rollback rehearsal or observation interval absent from the committed
  receipt.

## Deliberately still open

`feat-435` remains the authority for a new small-source local and production
ingestion proof, downstream soak, consumer inventory, rollback exercise, final
snapshot and retention ownership, old-service retirement, and archival of the
standalone repository. None of those actions is implied by this recovery PR.

## Acceptance rule going forward

A roadmap resolution may cite only committed evidence that states an observed
result. A procedure, prepared artifact, test of the same mechanism at a lower
layer, or historical recollection must be labelled as such. Missing historical
proof is recorded honestly and replaced by a new proof only in the feature that
actually performs it.
