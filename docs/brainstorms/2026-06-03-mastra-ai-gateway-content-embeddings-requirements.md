---
date: 2026-06-03
topic: mastra-ai-gateway-content-embeddings
related:
  - docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md
  - docs/brainstorms/2026-05-28-mastra-native-evaluation-search-eval-suite-requirements.md
  - docs/roadmap/content-discovery/feat-132-mastra-transcript-embedding-migration.md
  - docs/roadmap/content-discovery/feat-133-mastra-scene-embedding-workflow-migration.md
  - docs/roadmap/content-discovery/feat-134-mastra-experience-embedding-workflow-migration.md
  - docs/roadmap/content-discovery/feat-135-mastra-embedding-workflow-hardening.md
  - docs/roadmap/content-discovery/feat-139-mastra-offline-search-eval-runner-reports.md
---

# Mastra AI Gateway Content Embeddings

## Summary

Move Mastra-owned content embedding workflows to the Jesus Film AI Gateway while
preserving the current 1536-dimensional vector contract. Validate the new
provider path with the full Mastra local eval suite before immediately running a
coordinated full content backfill.

---

## Problem Frame

Mastra now owns background embedding generation for transcript, scene, and
experience content, while Admin owns vector storage, search retrieval, public
contracts, and live query embedding generation. The remaining provider concern
is that Mastra content embeddings still depend on the current OpenRouter/OpenAI
embedding path and key posture.

The Jesus Film AI Gateway is available as an OpenAI-compatible embeddings
endpoint and returns 4096-dimensional vectors by default. Forge's Admin vector
storage, pgvector indexes, ingest contracts, and search readers are built around
1536-dimensional vectors. A provider swap therefore needs an explicit
Matryoshka truncation and normalization contract, plus a search-quality gate
before production content vectors are replaced.

---

## Key Decisions

- **Mastra content only.** This migration covers Mastra-generated transcript,
  scene, and experience content vectors. Admin live query embeddings stay on the
  current provider path for this slice.
- **Preserve 1536 dimensions.** Gateway responses are truncated to 1536
  dimensions and re-normalized before Admin ingest sees them. The migration does
  not change pgvector column dimensions or indexes.
- **Validate locally before production writes.** A local prod-like Admin restore
  is the validation environment. Production backfill is blocked until the full
  Mastra local eval suite passes with an assigned judge.
- **Backfill immediately after the gate.** Once validation passes, operators run
  a coordinated full content backfill for all Mastra-owned embedding types
  rather than a long manual type-by-type migration.
- **Persist the validation evidence.** The full eval run JSON is stored under
  `docs/search-eval-reports/` so the migration decision is reviewable.

---

## Actors

- A1. Mastra: Owns background content embedding workflows, provider calls,
  provider validation, workflow diagnostics, and Studio-visible runs.
- A2. Admin: Owns vector storage, ingest contracts, pgvector indexes, search
  retrieval, public search APIs, and live query embedding generation.
- A3. Operator: Configures the gateway key, runs validation, reviews the eval
  report, and starts the full content backfill after the gate passes.
- A4. Search evaluator: Uses the Mastra local eval suite and judge-backed report
  to decide whether the gateway vectors are safe to promote.

---

## Key Flows

- F1. Gateway adapter validation
  - **Trigger:** The gateway key and endpoint are ready for local validation.
  - **Actors:** A1, A3
  - **Steps:** Mastra requests embeddings from the gateway, validates response
    shape, truncates vectors to 1536 dimensions, re-normalizes them, and verifies
    the final vectors satisfy the existing Admin ingest contract.
  - **Outcome:** The provider path is technically compatible with current
    1536-dimensional storage.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Local prod-like quality gate
  - **Trigger:** The gateway adapter works against test inputs and Mastra
    workflows can generate gateway-backed content vectors locally.
  - **Actors:** A2, A3, A4
  - **Steps:** A restored or sanitized Admin database is populated with
    gateway-backed Mastra content vectors, the full Mastra local eval suite runs
    with an assigned judge, and the full JSON report is written to
    `docs/search-eval-reports/`.
  - **Outcome:** The migration either passes the no-material-regression gate or
    is blocked before production content vectors are replaced.
  - **Covered by:** R6, R7, R8, R9, R10

- F3. Coordinated full content backfill
  - **Trigger:** The local validation gate passes.
  - **Actors:** A1, A2, A3
  - **Steps:** The operator starts one coordinated backfill action covering
    transcript, scene, and experience embeddings. Mastra generates gateway-backed
    1536-dimensional vectors and Admin persists them through the existing
    type-specific ingest paths.
  - **Outcome:** Production content vectors move to the gateway-backed provider
    contract without changing Admin search API behavior.
  - **Covered by:** R11, R12, R13, R14

---

## Requirements

**Provider Contract**

- R1. Mastra content embedding workflows must use the Jesus Film AI Gateway
  embeddings endpoint for transcript, scene, and experience content vectors.
- R2. The gateway key must be configured as a Mastra embedding-provider secret
  and must not reuse or expose the existing OpenRouter key.
- R3. Gateway requests must include the request shape and headers needed for the
  gateway to return embeddings reliably, including a non-default user agent if
  required by the gateway edge.
- R4. Mastra must treat the gateway's native vector length as provider output,
  then produce a final 1536-dimensional vector for Admin ingest by truncating
  and re-normalizing.
- R5. Mastra must reject malformed gateway responses, inconsistent item counts,
  non-finite vector values, and final vectors that do not match the 1536
  contract.

**Scope and Compatibility**

- R6. Admin live query embeddings must remain on the current provider path in
  this slice.
- R7. The migration must not change Admin pgvector column dimensions, indexes,
  public search response shapes, or GraphQL vector-exposure boundaries.
- R8. The validation gate must explicitly account for the temporary provider
  split between gateway-generated content vectors and current-provider query
  vectors.
- R9. Any model/provider metadata written for gateway-backed content vectors
  must make the provider change auditable without exposing secrets or raw
  provider payloads.

**Eval Gate**

- R10. A full Mastra local eval suite run is required before production
  gateway-backed content vectors are written over healthy existing vectors.
- R11. The eval suite must have an assigned judge. If the local Mastra suite
  currently lacks judge wiring, assigning and reporting the judge is part of the
  validation scope.
- R12. The eval gate passes only when judge calibration passes, net win rate is
  non-negative, and there are no clear Tier-1 regressions.
- R13. The full eval run JSON must be stored under `docs/search-eval-reports/`
  and must exclude secrets, raw production trace rows, credentials, cookies, IP
  addresses, and user identifiers.

**Backfill**

- R14. After the eval gate passes, the operator must be able to start a
  coordinated full content backfill covering transcript, scene, and experience
  embeddings.
- R15. The backfill should reuse or extend the existing embedding orchestration
  surface rather than requiring three unrelated manual runs.
- R16. The backfill must preserve type-level outcome reporting, failure
  isolation, idempotent reruns, and explicit repair/force/model-upgrade modes.
- R17. The backfill must not move live search orchestration or live query
  embedding generation into Mastra.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R5.** Given the gateway returns a 4096-dimensional
  embedding, when Mastra generates a content vector, then the vector submitted
  to Admin is 1536-dimensional, re-normalized, finite, and accepted by the
  existing ingest contract.
- AE2. **Covers R6, R8, R10, R12.** Given Admin live query embeddings still use
  the current provider, when the local validation suite runs against
  gateway-backed content vectors, then the eval report determines whether the
  split is search-quality safe before production backfill is allowed.
- AE3. **Covers R11, R12.** Given the eval suite is started without a judge, when
  validation runs, then the gate fails or refuses to start rather than producing
  an unjudged report.
- AE4. **Covers R13.** Given validation completes, when the report is committed
  under `docs/search-eval-reports/`, then it contains the full machine-readable
  eval result and excludes secrets, credentials, raw production trace rows, and
  direct user identifiers.
- AE5. **Covers R14, R15, R16.** Given the eval gate passes, when the operator
  starts the full content backfill, then transcript, scene, and experience
  embeddings are covered by one coordinated action while each type keeps its own
  outcomes and retry semantics.
- AE6. **Covers R7, R17.** Given the migration ships, when a live user searches,
  then Admin still owns the live search request path and public response shape.

---

## Success Criteria

- Mastra content embedding workflows can generate gateway-backed vectors that
  satisfy the existing 1536-dimensional Admin ingest contract.
- The full Mastra local eval suite produces a judge-backed report under
  `docs/search-eval-reports/` before production replacement.
- The migration passes the no-material-regression gate: calibrated judge,
  non-negative net win rate, and no clear Tier-1 regressions.
- A coordinated full content backfill can replace transcript, scene, and
  experience vectors after the validation gate passes.
- Admin live query embeddings, public search APIs, pgvector dimensions, and
  vector-exposure boundaries remain unchanged in this slice.

---

## Scope Boundaries

- Moving Admin live query embeddings to the Jesus Film AI Gateway is out of
  scope for this migration.
- Moving pgvector storage or indexes from 1536 to 4096 dimensions is out of
  scope.
- Production shadow vector tables, shadow columns, and production shadow search
  paths are out of scope for validation.
- Search eval human-promotion workflows and permanent regression-gate policy are
  out of scope beyond requiring a judge-backed validation report for this
  migration.
- Retuning the ranking strategy is out of scope unless the validation report
  exposes a blocking regression that must be fixed before backfill.

---

## Dependencies / Assumptions

- The Jesus Film AI Gateway remains available at
  `https://ai-gateway.jesusfilm.org/v1/embeddings` and continues to return
  OpenAI-compatible embedding responses.
- The gateway supports the existing content embedding batch sizes or the
  implementation can batch safely without changing workflow semantics.
- The current 1536-dimensional storage contract remains the production contract
  for transcript, scene, and experience vectors.
- A local prod-like Admin restore can be prepared without exposing production
  credentials or raw production trace rows in committed artifacts.
- The Mastra local eval suite can run against the restored local search state
  and can produce a judge-backed full JSON report.
- The existing embedding orchestration surface can either run all three content
  types together or be extended to support that coordinated action.

---

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R2, R3][Technical] Name the exact environment variables and provider
  config precedence for the gateway key and base URL.
- [Affects R4, R5][Technical] Decide where the truncate-and-normalize adapter
  lives so transcript, scene, and experience workflows cannot drift.
- [Affects R10, R11, R13][Technical] Decide whether the validation report is
  produced directly by the Mastra local eval suite or by a compatibility wrapper
  around the current Admin eval runner until the Mastra suite is fully native.
- [Affects R12][Product] Define how clear Tier-1 regressions are identified in
  the report if the suite reports a richer verdict taxonomy.
- [Affects R14, R15][Technical] Decide whether the coordinated backfill is an
  `all` mode on the existing local embedding CLI, a Mastra/Admin workflow, or a
  thin wrapper over existing type-specific backfills.

---

## Sources / Research

- `apps/mastra/src/services/embedding-provider.ts` - current Mastra provider
  helper and 1536-dimensional expectations.
- `apps/mastra/src/mastra/workflows/transcript-embedding.ts` - transcript
  workflow using the provider helper and Admin ingest.
- `apps/mastra/src/mastra/workflows/scene-embedding.ts` - scene workflow using
  the provider helper and Admin ingest.
- `apps/mastra/src/mastra/workflows/experience-embedding.ts` - experience
  workflow using the provider helper and Admin ingest.
- `apps/mastra/src/config/env.ts` - current OpenRouter/OpenAI provider config
  selection.
- `apps/admin/src/services/embeddings.service.ts` - Admin live query embedding
  path that remains out of scope for this slice.
- `apps/admin/src/scripts/run-embeds.ts` - existing operator-facing embedding
  backfill orchestration surface.
- `apps/admin/eval/README.md` - current eval data and report conventions.
- `apps/admin/src/services/search-eval/runner.ts` - current judge-required eval
  runner behavior.
- `apps/admin/src/services/search-eval/reporter.ts` - current eval JSON report
  writer and console summary.
- `docs/brainstorms/2026-05-25-mastra-embedding-search-migration-requirements.md`
  - upstream ownership and search observability decisions.
- `docs/brainstorms/2026-05-28-mastra-native-evaluation-search-eval-suite-requirements.md`
  - Mastra-native eval suite direction.
