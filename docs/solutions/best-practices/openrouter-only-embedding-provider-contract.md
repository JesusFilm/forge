---
title: "OpenRouter-only embedding provider contract"
date: 2026-06-08
category: best-practices
module: apps/admin
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - "Removing a fallback embedding provider"
  - "Changing the live query embedding model"
  - "Keeping operator readiness aligned with runtime credentials"
  - "Rolling out a provider-bound vector-space migration"
tags: [admin, embeddings, openrouter, qwen, search, readiness]
---

# OpenRouter-only embedding provider contract

## Context

Admin live search owns query embedding generation. When the query embedding
provider changes, the runtime call, the operator readiness surface, and the
stored vector corpus all become one deployment contract. Leaving an old fallback
in place can make local tests pass while production silently uses a different
vector space than the one operators believe is active.

## Guidance

Keep provider fallback removal explicit and testable:

- The embedding service should require the intended provider credential. If the
  live query path is OpenRouter-only, `OPENAI_API_KEY` must not satisfy readiness
  and must not trigger a fallback request.
- The outbound embedding request should pin both model and dimensions when the
  provider supports a dimension override.
- Operator UI and docs should name the same required credential that runtime
  code requires.
- Semantic retrieval should filter stored vectors by the active provider/model
  provenance. During a model-space rollout, old vectors in the same pgvector
  column must fail closed instead of being cross-compared.
- Any model-space change must carry a re-embed gate for the stored corpus before
  semantic quality is trusted.

For the OpenRouter Qwen query path, the provider body is intentionally explicit:

```ts
{
  model: "qwen/qwen3-embedding-8b",
  input: normalized,
  encoding_format: "float",
  dimensions: 1536,
}
```

The missing-credentials regression should set only `OPENAI_API_KEY` and assert
that query embedding still fails before `fetch` is called. That protects the
contract from accidental fallback reintroduction.

The semantic SQL should also require the approved content provenance tuple:

```sql
AND embedding_provider = 'jesus-film-ai-gateway'
AND model = 'embeddings'
AND dimensions = 1536
AND embedding_native_dimensions = 1536
AND embedding_transform_version IS NULL
```

This makes a deploy-before-backfill window degrade to keyword/partial semantic
results instead of silently comparing Qwen query vectors against legacy OpenAI
stored vectors.

## Why This Matters

Same-dimension vectors from different models are still different vector spaces.
The database will accept the comparison, but relevance quality becomes
untrustworthy. A hidden OpenAI fallback also makes incidents harder to reason
about: readiness may show healthy while the intended OpenRouter/Qwen path is not
actually configured.

## When to Apply

- Removing OpenAI fallback from Admin query embeddings.
- Changing `OPENROUTER_EMBEDDING_MODEL`.
- Adding or removing an embedding provider selector.
- Updating `/dashboard/search`, `/dashboard/embeddings`, or docs that report
  embedding provider readiness.
- Running a production embedding model upgrade.

## Examples

Before:

```ts
if (env.OPENROUTER_API_KEY) return openrouterProvider
if (env.OPENAI_API_KEY) return openaiProvider
```

After:

```ts
if (env.OPENROUTER_API_KEY) return openrouterProvider

throw new EmbeddingsBatchError(
  "missing_credentials",
  "OPENROUTER_API_KEY is required for embedding generation",
)
```

Readiness should make the same distinction:

```ts
const providerReady = Boolean(env.OPENROUTER_API_KEY)
```

## Related

- [Provider-bound content embedding backfill gate pattern](../architecture-patterns/provider-bound-content-embedding-backfill-gate-pattern.md)
- [Batched provider input position-stable contract](./batched-provider-input-position-stable-contract-20260505.md)
- [Silent semantic search degradation from a missing OpenRouter key](../runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md)
