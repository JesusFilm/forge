---
title: "Admin search query labeling and sampling pattern"
date: "2026-05-26"
category: "platform"
module: "apps/admin"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "Admin records production search traces for future eval sampling"
  - "Search trace labels must separate usefulness, safety, and privacy concerns"
  - "Optional LLM review is needed for ambiguous traces without entering the live request path"
tags:
  - admin
  - search
  - sampling
  - privacy
  - observability
  - llm
  - safety
related:
  - "docs/solutions/platform/admin-search-trace-retention-pattern.md"
  - "docs/roadmap/content-discovery/feat-137-search-query-quality-abuse-labeling.md"
  - "docs/plans/2026-05-26-004-feat-search-query-quality-abuse-labeling-plan.md"
---

# Admin Search Query Labeling Pattern

## Context

Production search traces are useful eval seed material, but the raw stream also
contains empty input, low-signal navigation, catalog lookups, malformed text,
spam, abuse, prompt-injection-like text, and sensitive data. The trace system
therefore needs rules-first labels that explain whether a query is useful for
future eval generation without changing the live search response.

Keep the model split into three independent questions:

- Query usefulness: is this a valid viewer-intent query, a lookup, low-signal,
  malformed, or ambiguous?
- Abuse: does this look like repeated spam, abusive input, or prompt injection?
- Privacy: does this contain sensitive user data that should be redacted and
  excluded from default sampling?

## Guidance

Use deterministic rules in the trace privacy layer before any optional LLM
classification. For feat-137 the rule provenance is:

- `queryLabelSource`: `rules`
- `queryLabelVersion`: `search-query-labels/v1`
- `queryLabeledAt`: the time the rule label was assigned

The deterministic query quality labels are:

- `valid_viewer_intent`
- `empty_too_short`
- `navigational`
- `catalog_lookup`
- `malformed`
- `unknown_ambiguous`

The deterministic abuse labels are:

- `none`
- `repeated_spam`
- `abusive`
- `prompt_injection_like`

Sensitive-query labels remain separate from both of those dimensions. A query
can be valid viewer intent and sensitive, or malformed and non-sensitive; do not
collapse those concepts into one moderation-style label.

Store rule provenance on raw traces and aggregate rollups. This makes future
rule changes auditable by version without rewriting old trace history. The
feat-137 migration deliberately normalizes feat-136 placeholder labels into the
v1 taxonomy and stamps older raw rows with `query_labeled_at = created_at`.

## Sampling Contract

Default sampling should be conservative:

- `sampleEligible = true`
- `queryQualityLabel = valid_viewer_intent`
- `sensitiveQueryLabel = none`
- `abuseLabel = none`
- raw trace has not expired

Broader sampling classes require explicit filters. This matters for future
Mastra eval jobs: a normal eval candidate pull should not accidentally include
catalog lookups, prompt-injection-like input, sensitive rows, or abusive rows.

Even when a caller explicitly requests sensitive or abusive classes, the sample
route must not return raw query text for those rows. Return a fixed placeholder
such as `[redacted-sample-query]` so the caller can measure category counts
without receiving sensitive or abusive content.

## Optional LLM Classification

The optional classifier is eval-side Admin code, not live search code. It lives
at `apps/admin/src/services/search-trace-query-classifier.ts` and must never run
from REST `/api/search`, GraphQL `Query.search`, or live query embedding
generation.

The classifier is only for safe ambiguous or high-impact samples:

- candidate raw trace is unexpired
- deterministic sensitivity and abuse labels are both `none`
- deterministic quality is `unknown_ambiguous`, or the trace is high-impact
  enough to justify review
- the row has not already been classified by the LLM path

Keep the call bounded and sanitized:

- strict OpenRouter JSON schema
- low output cap, currently `max_tokens: 300`
- request timeout, currently 30 seconds
- sanitized outbound prompt text
- sanitized diagnostics only
- no stored prompts, cookies, tokens, IP addresses, full user identifiers, raw
  sensitive data, vectors, or scoring debug payloads

Write LLM output to separate provenance fields such as `llmLabelSource`,
`llmLabelVersion`, `llmLabeledAt`, and sanitized notes. Do not overwrite the
deterministic rule label or pretend the LLM was the rule source.

Use an idempotent update when storing LLM results. The row may have expired,
become ineligible, or been classified by another worker between selection and
write.

## Why This Matters

The label version is part of the data contract. Aggregates and samples can be
explained later even after raw traces are purged, and future label revisions can
coexist with historical rows. This avoids the trap where a future eval report
cannot tell whether "valid" meant the old or new rule set.

The split between deterministic labels and optional LLM labels also keeps live
search reliable. Search trace write failures, rule failures, and eval classifier
failures must not fail or reshape the public REST or GraphQL search response.

## When to Apply

- Production search traces feed future eval generation or query analysis.
- Sampling needs to exclude low-signal, abusive, sensitive, or bad-actor input
  by default.
- A later offline workflow wants ambiguous sample review without putting an LLM
  in the live search request path.
- Rule changes need auditability by label source, version, and timestamp.

## Implementation Anchors

- Rule labels and redaction:
  `apps/admin/src/services/search-trace-privacy.ts`
- Trace writes, aggregate upserts, and sampling filters:
  `apps/admin/src/services/search-trace.service.ts`
- Internal sample HTTP contract:
  `apps/admin/src/app/api/internal/search-traces/sample/route.ts`
- Optional classifier:
  `apps/admin/src/services/search-trace-query-classifier.ts`
- Schema and migration:
  `apps/admin/prisma/schema.prisma` and
  `apps/admin/prisma/migrations/0022_search_trace_query_label_provenance/migration.sql`

## Gotchas

- Do not use query labels to censor, rerank, or alter live search results.
- Do not put Mastra, OpenRouter, or any LLM classifier in the live request path.
- Do not move live query embedding generation into Mastra.
- Do not let the sampling route return raw query text for sensitive or abusive
  rows, even when explicitly requested.
- Keep rule-based and LLM-based provenance separate.
- Keep the legacy aggregate unique key through the feat-137 rolling deployment.
  Drop it later with a separate migration after old Admin instances are drained;
  see `feat-143`.

## Related

- `docs/solutions/platform/admin-search-trace-retention-pattern.md`
- `docs/roadmap/content-discovery/feat-137-search-query-quality-abuse-labeling.md`
- `docs/roadmap/content-discovery/feat-143-drop-legacy-search-trace-aggregate-unique-key.md`
