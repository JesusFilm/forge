---
title: "Batched provider call with input-position-stable output contract"
date: "2026-05-05"
category: "best-practices"
problem_type: "best_practice"
component: "background_job"
root_cause: "inadequate_documentation"
resolution_type: "workflow_improvement"
severity: "medium"
module: "apps/admin"
tags:
  - openrouter
  - openai
  - embeddings
  - batched-call
  - input-position-stable
  - typed-error
  - embed-backfill
  - ai-pipeline
  - best-practice
related_features:
  - "feat-116"
  - "feat-117"
related:
  - "docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md"
  - "docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md"
  - "docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md"
  - "docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md"
  - "docs/solutions/database-issues/pgvector-bulk-insert-on-conflict-pattern-20260505.md"
---

# Batched provider call with input-position-stable output contract

## Problem

Stage 1 of admin's scene-embedding indexer issued one OpenRouter `embeddings` call per scene description, fanned out via `Promise.allSettled` so a per-scene blip didn't halt the whole indexer. At ~30 scenes per `(video, locale)` target × hundreds of targets, R1 was paying tens of thousands of round-trips when the provider supports batched input natively (`text-embedding-3-small` accepts up to 2,048 inputs per call). Each round-trip carries TLS + queueing + scheduling overhead the actual embed math doesn't.

Resolved in Stage 2 of the embed-backfill performance plan (`feat-116`).

## Symptoms

- N round-trips per target instead of one — provider call count scales as `targets × scenes-per-target`
- Per-target wall-time dominated by network round-trips, not by embed compute
- Provider rate-limit pressure scales with scene count, not with target count
- The per-scene `Promise.allSettled` "skip on individual provider failure" path produced partial-write outcomes that were structurally hard for downstream consumers to interpret (some scenes have vectors, some don't, with no visible signal which)
- Cost per backfill scales with total scene count rather than total target count

## What Didn't Work

- **Naively replacing the `for (scene of scenes) await embed(scene.description)` loop with `Promise.all(scenes.map(s => embed(s.description)))`.** Same N round-trips, same rate-limit pressure — concurrent rather than serial. Doesn't address the actual cost.
- **Sending one provider call but threading vectors back to scenes by matching on scene description text.** Breaks when two scenes have identical descriptions (real in highlight reels), and the provider's response shape doesn't carry the input back. Position-stability is the only sound contract.
- **A wrapper that retries per-scene on transient failures while staying single-call on the happy path.** The provider doesn't support partial-batch retry; the wrapper would have to fall back to per-scene calls on any error, defeating the win.

## Solution

One batched provider call per target with a position-stable output contract:

### 1. Batched provider entry point

```ts
export async function generateExperienceEmbeddings(
  inputs: readonly string[],
): Promise<GeneratedEmbeddings> {
  if (inputs.length === 0) {
    throw new EmbeddingsBatchError(
      "empty_input",
      "Embedding inputs must not be empty",
    )
  }

  const normalized: string[] = []
  for (let i = 0; i < inputs.length; i += 1) {
    const line = normalizeLine(inputs[i]!)
    if (!line) {
      throw new EmbeddingsBatchError(
        "empty_input",
        `Embedding input at index ${i} is empty after normalization`,
      )
    }
    normalized.push(line)
  }

  const provider = selectProvider() // throws EmbeddingsBatchError("missing_credentials")
  // … fetch with body { model, input: normalized, encoding_format: "float" } …

  if (parsed.data.data.length !== normalized.length) {
    throw new EmbeddingsBatchError(
      "length_mismatch",
      `Embedding response returned ${parsed.data.data.length} vectors for ${normalized.length} inputs`,
    )
  }
  // … per-element dimension validation …
  return {
    model: provider.model,
    dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    embeddings,
  }
}
```

Replaces N per-item calls with one POST whose `input` is the full array. Returns `{ model, dimensions, embeddings }` where `embeddings: number[][]`.

### 2. Input-position-stable output contract

`embeddings[i]` corresponds to `inputs[i]`. The provider returns vectors in input-array order; the service exhaustively validates that contract before returning. Length-mismatch and per-element dimension mismatches surface as typed errors, never as silent corruption. **Document the contract in the function JSDoc as the first sentence** — not buried in the type alias.

### 3. Typed error class with literal-union `code`

```ts
export class EmbeddingsBatchError extends Error {
  constructor(
    readonly code:
      | "empty_input"
      | "missing_credentials"
      | "request_failed"
      | "request_timed_out"
      | "validation_failed"
      | "length_mismatch"
      | "dimension_mismatch",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "EmbeddingsBatchError"
  }
}
```

Callers branch via `instanceof EmbeddingsBatchError && error.code === "..."` rather than regex-matching the message. Follows the established typed-error-classification pattern from `parallel-workflow-error-robustness-20260420.md`. The `code` literal-union is what gives TypeScript narrowing inside the `instanceof` branch and what makes `switch + never` exhaustiveness checks possible at consumer sites.

### 4. Consumer threads `embeddings[i]` back to entities by position

```ts
const sourceTexts = artifact.scenes.map((s) => s.description.trim())
const generated = await generateExperienceEmbeddings(sourceTexts)

// Defense-in-depth: the batched API throws on length mismatch already,
// but a future API change can't silently desync if we re-assert here.
if (generated.embeddings.length !== artifact.scenes.length) {
  throw new SceneIndexError(
    "artifact_invalid",
    `embedding response length ${generated.embeddings.length} does not match scene count ${artifact.scenes.length}`,
  )
}

const prepared = artifact.scenes.map((scene, i) => ({
  scene,
  sourceText: sourceTexts[i]!,
  embedding: generated.embeddings[i]!,
}))
```

Build the input array in the SAME ORDER as the entity array you'll thread back to. `sourceTexts = entities.map(e => e.text)`, then `prepared = entities.map((entity, i) => ({ entity, embedding: result.embeddings[i]! }))`. **Don't reorder either array between those two statements** — silent reordering is the most common bug shape this pattern guards against.

### 5. Singular convenience wrapper preserved for back-compat

```ts
export async function generateExperienceEmbedding(
  text: string,
): Promise<GeneratedEmbedding> {
  const normalizedText = normalizeLine(text)
  if (!normalizedText) {
    // PRESERVED literal message — back-compat callers
    // (hybrid-search.service.ts, experienceEmbedding.ts, ops-data.ts,
    // search/health/route.ts) catch on this exact string.
    throw new Error("Embedding input must not be empty")
  }
  const result = await generateExperienceEmbeddings([normalizedText])
  return {
    model: result.model,
    dimensions: result.dimensions,
    embedding: result.embeddings[0]!,
  }
}
```

Singular delegates to the batched form with `[normalizedText]`. Preserves the literal `"Embedding input must not be empty"` error message string — the typed `EmbeddingsBatchError` only surfaces to callers that opt in by calling the batched form. **Change the back-compat string only after auditing every consumer.**

### 6. Fail-fast for the whole target on length / dimension mismatch

The indexer's outer try/catch demotes the whole `(video, locale)` target to `failed` rather than partial-write. Trade-off accepted: transient provider blips (429/5xx) now fail the whole target instead of one scene; retry layer is deferred future work (see Residual Risks in the originating PR).

## Why This Works

- **Position-stable output is the only contract that survives duplicate inputs.** Matching by text fails on identical descriptions; matching by id fails when the provider doesn't return ids; matching by position is robust regardless of input content.
- **Typed error code is the right granularity for branching.** Callers that care about "provider quota exhausted" vs "provider returned malformed JSON" can branch precisely; callers that don't can catch on the class. Matches the parallel-workflow-error-robustness pattern admin already uses.
- **Fail-fast preserves correctness on the tail.** Partial-write across `Promise.allSettled` produced outcomes where "succeeded with N scenes" silently meant "of M actual scenes, N got vectors and M-N didn't" — operationally indistinguishable from a full success. The whole-target-or-nothing contract makes the failure visible and the report's `succeeded` count honest.
- **Convenience wrapper preserves the back-compat string.** Callers that catch on `"Embedding input must not be empty"` today (hybrid search query embedding, experience embedding pipeline) keep working unchanged. The typed `EmbeddingsBatchError` only surfaces to callers that opt in by calling the batched form.
- **Defense-in-depth length check at the consumer** catches a future API contract drift the unit tests can't anticipate. The cost is one branch; the catastrophe it prevents is the wrong vector landing on the wrong row.

## Verification

R1 smoke against local Postgres (Stage 2 PR, 2026-05-05):

- 24 batched OpenRouter calls (one per `(video, locale)` target) vs Stage 1's ~84 per-scene per-target calls
- All 24 targets succeeded; 0 length-mismatch / dimension-mismatch failures observed against real provider responses
- DB: `2_0-ComingHome` 60/60 locale rows + `2_0-Crushing` 24/24 locale rows have non-NULL `embedding` — position-stable contract held end-to-end

Unit tests that lock in the contract:

- `generateExperienceEmbeddings` issues exactly ONE fetch with `body.input` deep-equal to `inputs[]`; returns vectors in input order
- Length mismatch (provider returns N-1 vectors for N inputs) → `EmbeddingsBatchError("length_mismatch")`
- Per-element dimension mismatch → `EmbeddingsBatchError("dimension_mismatch")`
- AbortError → `EmbeddingsBatchError("request_timed_out")`
- Malformed response (zod parse failure) → `EmbeddingsBatchError("validation_failed")`
- Non-2xx response → `EmbeddingsBatchError("request_failed")`
- Missing credentials → `EmbeddingsBatchError("missing_credentials")`
- Empty input list / whitespace-only input → `EmbeddingsBatchError("empty_input")`
- Singular `generateExperienceEmbedding("   ")` throws `Error("Embedding input must not be empty")` — NOT `EmbeddingsBatchError` (back-compat contract)
- **Position-stability test:** mock provider returns distinct deterministic vectors per input position, assert each vector lands on the right scene's `$executeRaw` write — finds bound vector literals by SHAPE in mock calls (not by hardcoded parameter index, so resilient to SQL refactors)

## Prevention (checklist for the next batched provider integration)

1. **Document the position-stable contract in the function JSDoc as the first sentence.** "`embeddings[i]` corresponds to `inputs[i]`" must be visible from the call site, not buried in the return type alias.
2. **Validate length AND per-element shape before returning.** Length-mismatch and dimension-mismatch are different failure modes; treat them as distinct error codes so callers can branch.
3. **Branch on typed error code, not message regex.** Define a literal-union `code` field on the error class. Add a dedicated test per code so future refactors can't accidentally drop one. The full code arity must be reachable in tests.
4. **Re-assert length at the consumer** before constructing the position-paired array. Defense-in-depth — a future API change can't silently desync the contract.
5. **Build the input array in the same order as the entity array you'll thread back to.** `sourceTexts = entities.map(e => e.text)`, then `prepared = entities.map((entity, i) => ({ entity, embedding: result.embeddings[i]! }))`. Don't reorder either array between those two statements.
6. **Test for input-position stability with deterministic per-position vectors.** Mock the provider to return a vector whose values encode the input position so a swap surfaces as a vector mismatch, not a generic test failure. Find bound vector literals in mock `$executeRaw` calls by SHAPE (`/^\[[0-9.,-]+\]$/`) rather than by parameter index — survives future SQL parameter reorders.
7. **Preserve singular convenience wrappers for back-compat callers.** Delegate to the batched form with `[normalizedText]`. **Preserve the literal error-message string** that legacy callers catch on — change it only after auditing every consumer.
8. **Document the fail-fast trade-off explicitly** at the indexer's call site. Stage 1's per-item Promise.allSettled allowed per-item skip; the batched call doesn't. Operators interpreting the failure count after deploy need to know the change.
9. **If retry-on-transient is needed, add it inside the batched function**, not at the consumer. `request_failed` (429/5xx) and `request_timed_out` are deterministic candidates for retry; `length_mismatch` / `dimension_mismatch` / `validation_failed` are not.

## Cross-references

- `docs/solutions/best-practices/parallel-workflow-error-robustness-20260420.md` — the precedent for typed-error classification via `instanceof` + literal-union discriminant. `EmbeddingsBatchError` is the canonical application of this rule.
- `docs/solutions/best-practices/per-parent-child-memoization-loadedartifact-pattern-20260505.md` — sibling Stage 2 pattern; both apply to the same R1 indexer call site (the workflow loads the artifact once per group via that pattern, then this pattern handles the per-locale batched embedding call).
- `docs/solutions/runtime-errors/silent-semantic-search-degradation-missing-openrouter-key-20260415.md` — the precedent that motivated explicit `EmbeddingsBatchError("missing_credentials")` rather than a swallowed `null` return; the typed error makes silent degradation harder.
- `docs/solutions/best-practices/experience-embedding-pipeline-pgvector-strapi-v5-20260414.md` — the upstream pipeline whose singular `generateExperienceEmbedding(text)` contract this pattern preserves for back-compat.
- `apps/admin/src/services/embeddings.service.ts` — canonical implementation.
- `apps/admin/src/services/scene-embedding.service.ts` — canonical consumer with position-stable threading.
- Stage 2 PR (`feat-116`) — originating PR.
