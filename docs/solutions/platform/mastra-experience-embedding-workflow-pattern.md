---
title: "Mastra experience embedding workflow: source data from Admin, vectors through Admin ingest"
date: 2026-05-26
category: platform
module: apps/mastra
problem_type: architecture_pattern
component: service_object
severity: high
related_components:
  - apps/admin
  - packages/admin-graphql
tags:
  - mastra
  - experience-embedding
  - admin-ingest
  - pgvector
  - provenance
  - search
related_features:
  - feat-134
  - feat-133
  - feat-132
related:
  - "docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md"
  - "docs/solutions/platform/mastra-scene-embedding-workflow-pattern.md"
  - "docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md"
  - "docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md"
applies_when:
  - "Moving ExperienceLocale embedding generation out of Admin provider calls"
  - "Adding a Mastra workflow that writes vectors into Admin-owned pgvector tables"
  - "Reviewing experience embedding provenance, idempotency, or Studio output boundaries"
---

# Mastra Experience Embedding Workflow Pattern

## Context

Experience embeddings are different from scene and transcript embeddings because
Admin is both the source-of-truth writer and the search owner. feat-134 moves
only provider-side generation into Mastra.

The ownership line is:

- Admin owns ExperienceLocale storage, publish/archive eligibility, source text
  assembly, source hashing, pgvector columns, indexes, public contracts, and
  search retrieval.
- Mastra owns experience embedding generation, provider calls, provider response
  validation, retries, workflow failures, and Studio observability.
- Admin ingest remains experience-specific. Do not add a generic vector blob
  endpoint.

Do not use this pattern to move live query embeddings or live search
orchestration into Mastra. Query-time retrieval remains Admin-owned.

## Guidance

Keep the flow source-data driven:

1. Admin resolves an eligible published, unarchived ExperienceLocale.
2. Admin builds source text from title, meta fields, OG fields, and block text,
   then sends `{ text, contentHash, summary }` plus target ids to Mastra.
3. Mastra validates `sha256(text) === contentHash`, generates exactly one
   1536-dimensional vector, validates provider shape, and submits the final
   payload to Admin's experience ingest endpoint.
4. Admin re-resolves the target inside a transaction, rechecks publish/archive
   eligibility, rechecks the current source hash and summary, locks the locale,
   and writes the vector plus compact provenance.
5. Existing Admin search continues reading `experience_locale.embedding`; public
   REST and GraphQL response shapes do not change.

The provenance stored on `ExperienceLocale` is compact and internal-only:

- source content hash
- safe source summary
- model name and dimensions
- provider
- generation mode
- Mastra run id
- generated timestamp

Do not expose those fields through normal GraphQL, public REST, or Mastra
Studio step output. Mastra can keep the run id internally for Admin ingest, but
workflow step outputs and route responses should be scrubbed to status and
target-safe fields only.

## Why This Matters

This split gives Mastra the operational visibility for AI generation without
weakening Admin's publication and search guarantees:

- Draft and archived experiences are rejected before provider spend and again at
  Admin ingest.
- Source hash mismatches catch edits made after Admin launched the workflow.
- Advisory locks and serializable ingest transactions prevent concurrent writes
  from racing stale provenance into the vector column.
- Search stays stable because hybrid retrieval still reads the same pgvector
  table and public result shapes stay unchanged.

Idempotency belongs at Admin ingest. Default `idempotent` mode no-ops only when
an existing healthy vector has matching provenance. `repair` rewrites only
missing or unhealthy vectors when provenance still matches. `force` and
`model-upgrade` are explicit rewrite modes.

## When to Apply

Use this pattern when a background workflow needs to generate or refresh
ExperienceLocale vectors. Do not apply it to live query embeddings, public search
orchestration, scene artifacts, transcript chunks, or any CMS/Strapi compatibility
surface.

## Examples

Admin launch payload:

```ts
{
  target: {
    experienceId,
    experienceLocaleId,
    locale,
    slug,
  },
  source: {
    text,
    contentHash,
    summary,
  },
  mode: "idempotent",
}
```

Mastra's Admin ingest payload adds provider output and internal provenance:

```ts
{
  target,
  source: { contentHash, summary },
  model: { name, provider, dimensions: 1536 },
  generation: { mode, generatedAt, mastraRunId },
  embedding,
}
```

Review traps:

- Do not let Admin call the production embedding provider for ExperienceLocale
  background generation after the Mastra workflow is wired.
- Do not let repair mode collapse into force mode for healthy vectors.
- Do not enumerate archived parent experiences during backfill.
- Do not return `mastraRunId`, source hashes, summaries, model names, provider
  tokens, or vectors from Studio-visible workflow outputs.
- Do not protect Mastra's built-in `/api/workflows` routes with the service
  bearer guard; keep it scoped to explicit `/forge-*` service routes.

Validation:

```bash
pnpm --filter @forge/admin db:generate
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin test -- experienceEmbeddingBackfill.test.ts graphql/mutations/experience-embedding-backfill.test.ts hybrid-search-retrievers.test.ts hybrid-search.service.test.ts search-eval/fingerprint.test.ts experience-embedding-ingest.service.test.ts experience-embedding-ingest.contract.test.ts mastra-experience-embedding-client.test.ts app/api/internal/mastra/experience-embeddings/route.test.ts experienceEmbedding.test.ts experience.embedding.test.ts graphql/schema.test.ts graphql/schema.security.test.ts
pnpm --filter @forge/admin typecheck
pnpm --filter @forge/admin lint
pnpm --filter @forge/mastra lint
pnpm --filter @forge/admin-graphql lint
pnpm --filter @forge/admin-graphql typecheck
git diff --check
```

## Related

- `docs/solutions/platform/mastra-scene-embedding-workflow-pattern.md`
- `docs/solutions/platform/mastra-transcript-embedding-workflow-pattern.md`
- `docs/solutions/architecture-patterns/admin-semantic-video-transcript-evidence-pattern.md`
