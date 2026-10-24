---
title: "Internal diagnostic search modes need mode-aware eval identity"
date: "2026-06-21"
category: "architecture-patterns"
module: "apps/admin, apps/mastra"
problem_type: "architecture_pattern"
component: "service_object"
severity: "medium"
applies_when:
  - "A search mode is useful for offline evaluation but should not become a public product mode"
  - "The same prompt set is evaluated across multiple retrieval modes"
  - "Native Evaluation records are synced from search eval reports"
related_components:
  - "apps/admin"
  - "apps/mastra"
tags:
  - "search-eval"
  - "semantic-search"
  - "native-evaluation"
  - "internal-contracts"
  - "mode-identity"
related:
  - "docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md"
  - "docs/solutions/architecture-patterns/mastra-native-evaluation-search-eval-bridge-pattern.md"
  - "docs/solutions/platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md"
---

# Internal Diagnostic Search Modes Need Mode-Aware Eval Identity

## Context

Watch search readiness needed a `semantic-only` mode so the team could measure
vector retrieval without keyword, title, or full-text retrieval helping the
result set. That mode is useful for offline evaluation, but it is not a public
Watch search decision.

Admin already accepts free-form `mode` strings at public REST and GraphQL
boundaries so future public modes can roll out without schema churn. If
`semantic-only` is added to the global decoder without another guard, public
callers can activate it immediately by passing that raw string. Mastra also
syncs reports into native Evaluation records, so a second failure mode appears:
multi-mode runs over the same prompt set can overwrite or mingle Dataset items
unless the requested mode is part of native identity.

## Guidance

Treat diagnostic search modes as privileged internal execution, not as global
public mode recognition.

In Admin, keep public boundaries stringly typed and tolerant, but make the
service decoder require an internal option before it recognizes the diagnostic
mode:

```ts
export function normalizeMode(
  raw: string | null | undefined,
  logger: { warn: (message: string) => void },
  options: { allowInternalEvalModes?: boolean } = {},
): SearchPipelineMode {
  if (raw == null || raw === "" || raw === "hybrid") return "hybrid"
  if (raw === "keyword-first") return "keyword-first"
  if (raw === "semantic-only" && options.allowInternalEvalModes === true) {
    return "semantic-only"
  }
  logger.warn(`[search] event=search_unknown_mode ...`)
  return "hybrid"
}
```

Only the authenticated internal eval route should pass the option:

```ts
await service.search({
  query,
  locale,
  mode,
  allowInternalEvalModes: true,
})
```

The diagnostic branch should skip every lexical retriever. If query embedding
fails, do not silently fall back to keyword retrieval; return the existing
search response shape with an empty result set and the normal degradation
signal. The requested pipeline mode stays in eval metadata, while
`searchMode` remains the runtime embedding-health signal.

In Mastra, allow diagnostic modes only in offline eval workflow schemas and
Admin-eval payloads. Reject non-scope modes such as `algolia-backed` when the
ticket explicitly keeps Algolia as prompt provenance only.

When syncing report results into native Evaluation, include the requested mode
in every identity that can collide:

- Dataset name and native key.
- Experiment name and native key.
- Dataset item source key.

Mode-specific baseline names are still good operator hygiene, but code should
not rely on operators remembering them. If `hybrid` and `semantic-only` reports
share a baseline name by accident, they should still sync into separate native
Datasets instead of creating mixed-mode items inside one experiment.

## Why This Matters

Diagnostic modes often have deliberately bad user-facing behavior. A
semantic-only eval mode can return no results when embeddings are unavailable,
which is correct for diagnosis and unacceptable as a public fallback.

Mode-aware native identity protects the review surface. Without it, one mode
can update another mode's Dataset item, or worse, a new experiment can run
against Dataset items from a different requested mode and fail because no
output exists for those source keys.

## When To Apply

- Adding an eval-only or operator-only retrieval mode.
- Comparing one prompt set across `hybrid`, `keyword-first`, and diagnostic
  modes.
- Projecting search eval reports into native Evaluation records.
- Keeping public REST or GraphQL mode arguments forward-compatible while
  avoiding accidental public activation.

## Examples

Good coverage has three layers:

```ts
expect(normalizeMode("semantic-only", logger)).toBe("hybrid")
expect(
  normalizeMode("semantic-only", logger, { allowInternalEvalModes: true }),
).toBe("semantic-only")
```

```ts
await service.search({
  query: "jesus",
  locale: "en",
  mode: "semantic-only",
  allowInternalEvalModes: true,
})

expect(searchVideoSemantic).toHaveBeenCalled()
expect(searchVideoKeyword).not.toHaveBeenCalled()
expect(searchByKeywordWeighted).not.toHaveBeenCalled()
expect(searchExperienceKeyword).not.toHaveBeenCalled()
```

```ts
expect(first.dataset.nativeKey).toContain("mode:hybrid")
expect(second.dataset.nativeKey).toContain("mode:semantic-only")
expect(second.dataset.datasetId).not.toBe(first.dataset.datasetId)
```

## Related

- [Mastra offline search eval orchestration boundary pattern](./mastra-offline-search-eval-orchestration-boundary-pattern.md)
- [Mastra native Evaluation search eval bridge pattern](./mastra-native-evaluation-search-eval-bridge-pattern.md)
- [Admin hybrid search keyword-first R4 extension pattern](../platform/admin-hybrid-search-keyword-first-r4-extension-pattern.md)
