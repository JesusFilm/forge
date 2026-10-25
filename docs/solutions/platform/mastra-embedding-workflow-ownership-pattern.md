---
title: "Mastra embedding workflow ownership: generation in Mastra, storage and search in Admin"
last_updated: 2026-05-26
date: 2026-05-26
date_learned: 2026-05-26
problem_type: architecture_pattern
component: service_object
severity: high
module: apps/mastra
related_components:
  - apps/admin
  - apps/manager
tags:
  - mastra
  - embeddings
  - admin-ingest
  - pgvector
  - manager
  - provenance
  - search
related_features:
  - feat-135
  - feat-134
  - feat-133
  - feat-132
related:
  - "docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md"
  - "docs/solutions/platform/mastra-scene-embedding-workflow-pattern.md"
  - "docs/solutions/platform/mastra-experience-embedding-workflow-pattern.md"
  - "docs/solutions/integration-issues/mastra-studio-api-auth-guard.md"
applies_when:
  - "Adding or hardening a background embedding workflow"
  - "Reviewing ownership between Manager, Mastra, and Admin"
  - "Changing embedding ingest, provenance, retry, or mode semantics"
---

# Mastra Embedding Workflow Ownership Pattern

## Context

feat-132, feat-133, and feat-134 moved transcript, scene, and experience
background embedding generation into Mastra. feat-135 hardened the shared
pieces after those concrete migrations landed.

The final ownership line is:

- Manager owns upstream artifacts where applicable: transcript JSON and
  scene-analysis JSON. It does not generate vectors or run CMS embedding sync.
- Mastra owns background embedding generation: provider calls, provider-result
  validation, retries, workflow diagnostics, and Studio observability.
- Admin owns type-specific ingest, target resolution, vector storage,
  publication gates, pgvector indexes, public search contracts, and retrieval.

Do not move live user search orchestration or live query embedding generation to
Mastra. Admin search services remain the query-time owner.

## Shared Hardening

All Mastra embedding workflows should use the shared provider validation before
submitting to Admin:

- provider result count must match input count
- provider response indexes must be in range and unique
- every vector value must be finite
- every vector dimension must match the configured model dimensions

Validation failures should throw inside the workflow step. A failed provider
shape must appear as a failed Mastra Studio run, not a green run containing a
hidden `{ ok: false }` result.

All Mastra workflows should also use the shared Admin ingest transport behavior:
consistent bearer handling, JSON parsing, error envelopes, timeouts, and
Admin-status parsing. Treat `429` and `5xx` responses as retryable even when
the Admin error envelope is absent or says otherwise; those failures represent
transient transport or service conditions from Mastra's point of view. Keep
payload schemas local and type-specific:

- transcript workflow calls Admin transcript ingest
- scene workflow calls Admin scene ingest
- experience workflow calls Admin experience ingest

Do not replace those routes with a generic embedding blob endpoint.

## Mode Semantics

Generation modes have the same meaning across transcript, scene, and
experience ingest:

- omitted / `idempotent`: write only when no healthy matching vector exists
- `repair`: rewrite missing or unhealthy vectors when source/model provenance
  still matches
- `force`: intentionally rewrite the current target
- `model-upgrade`: intentionally rewrite because the model/provider changed

Admin returns compact status language across concrete services:
`created`, `unchanged`, `repaired`, `forced`, `model_upgraded`, or `rejected`.
Idempotent and repair paths should not churn healthy rows.

The rewrite-status helper should only accept rewrite modes (`repair`, `force`,
and `model-upgrade`). Keep `idempotent` at the call-site branch so TypeScript
prevents accidental rewrite-status lookups instead of relying on a runtime
throw that tests may not exercise.

## Code Anchors

- Mastra provider validation lives in
  `apps/mastra/src/services/embedding-provider.ts`.
- Mastra's shared Admin transport lives in
  `apps/mastra/src/services/admin-embedding-ingest-client.ts`.
- Admin's shared mode/outcome language lives in
  `apps/admin/src/services/embedding-ingest-shared.ts`.
- The concrete workflow contracts remain in
  `apps/mastra/src/mastra/workflows/transcript-embedding.ts`,
  `apps/mastra/src/mastra/workflows/scene-embedding.ts`, and
  `apps/mastra/src/mastra/workflows/experience-embedding.ts`.

## Review Traps

- Do not import from `apps/admin`, `apps/manager`, or `apps/auth` in Mastra.
  Use HTTP contracts and local types.
- Do not weaken source validation while sharing helpers. Transcript, scene, and
  experience payloads still have different source shapes.
- Do not let Manager retain retired transcript embedding artifact sync or
  override paths.
- Do not expose vectors, raw source text, or provider secrets in Studio step
  summaries, Admin GraphQL, or public REST responses.
- Keep Mastra service-bearer auth scoped to explicit `/forge-*` service routes.
  Studio's built-in `/api/workflows` calls must continue to work.

## Verification

For hardening changes, run focused coverage in all three owners:

- Mastra provider/client/workflow tests plus typecheck
- Admin type-specific ingest/storage/search tests plus typecheck
- Manager workflow/UI tests when removing source-artifact or sync scaffolding

For runtime validation, also open Mastra Studio and verify all three workflows
are discoverable through the built-in workflow UI. Check `/api/workflows`
without a service bearer and one explicit `/forge-*` route both without and with
the local bearer. This proves service-route auth is still scoped and Studio's
operator surface stays usable.

When credentials are available, run one live provider smoke with representative
source text and record only count, dimensions, finite-value status, and
model/provider metadata. Do not print provider secrets, raw vectors, or source
text in logs or docs.

If an Admin Pothos schema changes, regenerate `apps/admin/schema.graphql` and
`packages/admin-graphql` in the same PR. The feat-135 hardening pass did not
change public REST or GraphQL response shapes.
