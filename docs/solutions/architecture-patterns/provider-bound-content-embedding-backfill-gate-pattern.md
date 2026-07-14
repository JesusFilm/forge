---
title: "Provider-bound content embedding backfill gate pattern"
date: "2026-06-03"
last_updated: "2026-06-07"
category: "architecture-patterns"
module: "apps/mastra, apps/admin"
problem_type: "architecture_pattern"
component: "service_object"
severity: "high"
applies_when:
  - "A content embedding provider migration needs a production backfill gate"
  - "A native-dimension embedding response must be bound to pgvector storage provenance"
  - "Offline search eval artifacts are used to authorize a destructive or high-churn vector rewrite"
  - "Multiple embedding content types must move together without accepting mixed provider provenance"
  - "Multilingual content embeddings need local proof before full all-locale backfill"
related_components:
  - "apps/mastra"
  - "apps/admin"
tags:
  - "embeddings"
  - "ai-gateway"
  - "mastra"
  - "search-eval"
  - "backfill-gate"
  - "pgvector"
  - "matryoshka"
  - "provenance"
related:
  - "docs/solutions/platform/mastra-embedding-workflow-ownership-pattern.md"
  - "docs/solutions/architecture-patterns/mastra-offline-search-eval-orchestration-boundary-pattern.md"
  - "docs/solutions/architecture-patterns/mastra-seed-baseline-portability-pattern.md"
  - "docs/roadmap/content-discovery/feat-156-mastra-ai-gateway-content-embeddings.md"
---

# Provider-Bound Content Embedding Backfill Gate Pattern

## Context

The AI Gateway content embedding migration moves active transcript and
experience embedding generation away from OpenRouter/OpenAI-compatible
credentials and onto the Jesus Film AI Gateway endpoint. The current production
gateway returns native 1536-dimensional unit vectors for `model: embeddings`,
and Admin stores those vectors in existing `vector(1536)` pgvector columns
with `embedding_transform_version=NULL`.

That shape creates a new failure mode: a search eval report can look generally
positive while proving the wrong embedding population. For example, it might be
produced from legacy OpenAI rows, a synthetic fixture, a report from a different
provider, or a 4096/truncate report from an older local run instead of the
current native-1536 production contract. A production backfill gate must
therefore bind the eval artifact to the exact provider contract it is
approving.

## Guidance

Treat provider provenance as part of the migration gate, not as decoration in
logs. The eval export that operators hand to Admin should include a sanitized
`contentEmbeddingProvider` block with the full tuple:

```json
{
  "provider": "jesus-film-ai-gateway",
  "model": "embeddings",
  "requestModel": "embeddings",
  "nativeDimensions": 1536,
  "finalDimensions": 1536,
  "transformVersion": null
}
```

The Mastra provider client should request the normal embedding endpoint without
a `dimensions` parameter and validate that the native response has the expected
configured dimensions. For current production native-1536 output, Mastra should
not slice or re-normalize and should send `transformVersion: null` to Admin
alongside the vector payload. If a future gateway variant truly returns 4096
dimensions, re-enable the existing slice-to-1536/re-normalize transform and
bind the gate report to the 4096/native transform tuple instead. Do this for
every content type that writes vectors, not only the first workflow you migrate.

Admin should persist both native and final provenance. The final pgvector column
stays `vector(1536)`, but active transcript and experience rows should also
track the embedding provider, native dimensions, and transform version. Healthy
idempotent checks must compare that provenance so a gateway migration does not
mistake legacy OpenAI rows for current gateway rows. Historical scene rows are
retained for feat-199 and should not be rewritten by this active content
backfill path. If old active rows predate provider columns, support only narrow
legacy compatibility for known OpenAI model stamps; do not use null provider
fields as a generic match.

Require a full, provider-bound gate report before production all-content
backfill. The Admin runner should validate more than a truthy `backfillReady`
flag:

- the report file lives directly under `docs/search-eval-reports/`
- the filename matches `gate.reportId`
- the report has the expected schema, exported timestamp, gate summary,
  comparable evidence counts, judge/calibration state, and orchestrator summary
- the embedded search-eval report agrees with the outer gate fields
- losses, search failures, judge failures, and judge disagreements are zero
- the assigned judge is present and calibration is not skipped
- the provider tuple matches the active gateway tuple exactly

Also distinguish config provenance from corpus provenance. A docs report that
records the active Mastra provider config proves what query embeddings and new
workflow writes are configured to use; it does not, by itself, prove the
searched Admin rows have already been rewritten. For destructive production
work, pair the eval gate with row-level provenance counts for the evaluated
transcript and experience corpus, or expose a sanitized Admin internal
provenance summary and embed that summary in the gate report. Do not authorize a
wipe or backfill from a config-only tuple when the production question is
"which stored rows did this eval actually search?"

Keep local bypasses deliberately narrow. A no-report run is acceptable only for
local development databases on loopback hosts with names that clearly contain
`local`, `test`, `dev`, or `development`. Production, shared, or ambiguous
database URLs should require the report even if the operator is running the
script from a laptop.

For multilingual migrations, add a local validation layer between English smoke
and all-locale backfill. Core sync success, embedding success, and search eval
success are different proofs:

- Core sync success proves the local catalog has video, locale, edition, dub,
  download, and Mux rows for the target languages.
- Workflow target availability proves the embedding enumerator can derive
  `(video, edition, locale)` and `(video, edition, language)` targets from
  primary language, subtitle, and dub data.
- Bounded embed batches prove Mastra can fetch Manager artifacts, call the
  gateway provider, produce `vector(1536)`, and write through Admin ingest
  callbacks for each language.
- A multilingual eval baseline and judged comparison prove local search can use
  those vectors without losses, search failures, judge failures, or judge
  disagreements.

Do not use "we synced locales" as shorthand for "multilingual search is
validated." The 2026-06-03 local run synced a 1,099-video catalog and had
hundreds of published localized videos/dubs for `es`, `fr`, `pt`, `de`, `ru`,
and `ar`, but only the bounded batches proved gateway vectors for selected
targets. The clean compact batches were `20/20` scene and `20/20` transcript
targets for Spanish, Portuguese, German, Russian, and Arabic; French had `13/13`
available targets. One earlier broad Spanish full-film transcript timed out,
which is useful operational signal but not a quality regression when followed
by a clean compact Spanish top-up.

Make the report safe to commit. The docs JSON may contain pass/fail summaries,
counts, provider provenance, locale mix, and sanitized identifiers. It must not
include raw vectors, raw source text, raw query text, provider prompts,
bearer tokens, URL credentials, or token-like query parameters.

## Why This Matters

Embedding migrations are easy to make half-correct. The code can write vectors
successfully while search quality regresses because stored documents and query
embeddings no longer share the same transformed vector space. Binding the gate
to provider, native dimensions, final dimensions, and transform version makes
the eval evidence auditable and prevents an old or forged report from
authorizing a full rewrite.

The pattern also protects rollback and idempotency. Admin can distinguish
legacy OpenAI rows, current gateway rows, and future provider upgrades without
inspecting vector values or relying on model-name strings alone.

Embedding more multilingual rows is better when it is bounded by this evidence:
it improves retrieval coverage for localized queries because transcript
retrievers have real same-locale vectors to rank instead of leaning on lexical
matches or unrelated locales. It is not automatically "better" just because the
row count increased. Quality evidence comes from the eval delta:
English post-batch comparison against the production seed baseline produced
`8` wins and `0` losses; the fresh multilingual baseline comparison produced
`6` ties, `0` losses, `0` search failures, `0` judge failures, and `0` judge
disagreements. That means English improved against the old baseline, while
multilingual search was stable against the newly captured local multilingual
standard. It does not yet prove multilingual improvement against a pre-migration
multilingual baseline because that baseline did not exist.

## When to Apply

- A provider migration will rewrite transcript, experience, or other
  pgvector-backed content rows.
- The provider's native output and transform status are part of the production
  backfill gate.
- A search eval artifact is used as an operator gate for a backfill.
- Multiple services share ownership: Mastra generates, Admin stores/searches,
  and operators need durable evidence under `docs/search-eval-reports/`.

## Examples

The operator flow is two-step. First generate the provider-bound eval report:

```bash
pnpm --filter @forge/mastra eval:content-embedding-gate -- \
  --baseline-name=prod-seed-baseline-YYYY-MM-DD \
  --environment-label=local
```

Then pass the emitted docs report to the all-content backfill:

```bash
pnpm --filter @forge/admin run-embeds -- \
  --pipeline=all \
  --transcript-mode=model-upgrade \
  --experience-mode=model-upgrade \
  --gate-report=docs/search-eval-reports/<reportId>.json \
  --report-out=.tmp/prod-embeds/content-ai-gateway-backfill.json
```

The backfill runner should reject a minimal JSON file that only says
`backfillReady: true`. It should require the full eval artifact shape and the
same provider tuple Mastra is configured to write.

For local multilingual validation, run the same pattern in smaller pieces:

```bash
# 1. Run Core sync and confirm coverage before embedding.
TSX_TSCONFIG_PATH=apps/admin/tsconfig.json \
  node --env-file=apps/admin/.env --import tsx \
  apps/admin/src/scripts/run-core-sync.ts

# 2. Run bounded per-language transcript batches.
TSX_TSCONFIG_PATH=apps/admin/tsconfig.json \
  node --env-file=apps/admin/.env --import tsx \
  apps/admin/src/scripts/run-embeds.ts \
  --pipeline=transcript \
  --transcript-mode=model-upgrade \
  --locale=de \
  --language=de \
  --core-id=<core-id> \
  --report-out=docs/search-eval-reports/<local-language-batch>.json

# 3. Capture a local multilingual seed baseline, then run the judged gate.
node --env-file=apps/mastra/.env --import tsx \
  apps/mastra/src/scripts/run-content-embedding-search-eval.ts \
  --baseline-name=local-multilingual-seed-baseline-YYYY-MM-DD \
  --locale=es --locale=fr --locale=pt --locale=de --locale=ru --locale=ar \
  --environment-label=local-multilingual \
  --out=docs/search-eval-reports/<local-multilingual-gate>.json
```

If native Mastra Evaluation sync is unavailable locally, keep the baseline and
comparison artifacts. Native sync failure is an operator-surface problem; it is
not the same as search eval failure when the offline baseline and judged docs
report are both written and pass.

## Related

- `apps/mastra/src/services/embedding-provider.ts`
- `apps/mastra/src/scripts/run-content-embedding-search-eval.ts`
- `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
- `apps/admin/src/scripts/run-embeds.ts`
- `docs/search-eval-reports/README.md`
- `docs/search-eval-reports/2026-06-03-ai-gateway-local-gate-summary.md`
- `docs/search-eval-reports/2026-06-03-local-multilingual-post-batch-search-eval.json`
