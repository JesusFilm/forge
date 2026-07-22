---
id: "feat-156"
title: "Mastra AI Gateway content embeddings migration"
owner: "nisal"
priority: "P0"
status: "complete"
start_date: "2026-06-03"
duration: 3
depends_on:
  - "feat-135"
  - "feat-148"
  - "feat-154"
blocks:
  - "feat-157"
tags:
  - "admin"
  - "mastra"
  - "search"
  - "ai-pipeline"
  - "embeddings"
  - "pgvector"
  - "evals"
---

## Completion Decision

Marked complete on 2026-07-21. PR #1122 delivered the shared Jesus Film AI
Gateway provider path, provenance-aware Admin ingest, the content search-eval
release gate, committed gate reports, and the gated all-content backfill
operator flow. PR #1160 then aligned that path with the gateway's native
1536-dimensional production response. The repository contains passing local
gate and backfill artifacts under `docs/search-eval-reports/`; those artifacts
verify the migration machinery but do not independently prove that a full
production replacement run occurred. The scene embedding branch was retired
later in PR #1427 without undoing the completed provider migration for the
remaining content embedding paths.

## Problem

Mastra now owns background transcript, scene, and experience embedding
generation, but the shared provider path still depends on the OpenRouter/OpenAI
embedding key posture. The Jesus Film AI Gateway is available as an
OpenAI-compatible embeddings endpoint, and the current production endpoint has
been verified to return native 1536-dimensional unit vectors for
`model: embeddings`.

Admin's pgvector columns, ingest contracts, indexes, and search retrievers
still use 1536-dimensional vectors. The provider migration must therefore keep
the existing 1536 contract without applying a client transform to the current
native-1536 gateway output. Production content vectors should only be replaced
after the full Mastra eval suite passes with an assigned judge and a durable
full JSON report bound to the current native-1536 provider tuple.

## Entry Points - Read These First

1. `docs/brainstorms/2026-06-03-mastra-ai-gateway-content-embeddings-requirements.md`
   - user-confirmed scope, gateway constraints, validation gate, and backfill
     requirements.
2. `docs/plans/2026-06-03-001-feat-mastra-ai-gateway-embeddings-plan.md`
   - implementation sequencing for this ticket.
3. `apps/mastra/src/services/embedding-provider.ts`
   - shared provider request, response validation, dimensions, and metadata.
4. `apps/mastra/src/config/env.ts`
   - Mastra embedding provider env parsing and production config assertion.
5. `apps/mastra/src/mastra/workflows/transcript-embedding.ts`
   - transcript embedding workflow provider call and Admin ingest handoff.
6. `apps/mastra/src/mastra/workflows/scene-embedding.ts`
   - scene embedding workflow provider call and Admin ingest handoff.
7. `apps/mastra/src/mastra/workflows/experience-embedding.ts`
   - experience embedding workflow provider call and Admin ingest handoff.
8. `apps/mastra/src/mastra/workflows/search-eval-orchestrator.ts`
   - validation gate and release-gate summary path.
9. `apps/mastra/src/services/offline-search-eval/`
   - judge, report, artifact, and native Evaluation projection code.
10. `apps/admin/src/scripts/run-embeds.ts`
    - local operator backfill surface for scene, transcript, and experience
      embedding workflows.

## Grep These

```bash
rg -n "requestEmbeddingVectors|EXPECTED_.*DIMENSIONS|OPENROUTER|OPENAI_EMBEDDINGS|EmbeddingProviderError" apps/mastra/src
rg -n "search-eval-orchestrator|release-gate|netWinRate|judge calibration|reportPath" apps/mastra/src
rg -n "run-embeds|pipeline=scene|pipeline=transcript|pipeline=experience|pipeline=both|pipeline=all" apps/admin/src/scripts
rg -n "mastraRunId|dimensions: 1536|model-upgrade|provider" apps/admin/src/services apps/admin/src/app/api/internal/mastra
```

## What To Build

1. Add Jesus Film AI Gateway embedding provider configuration to Mastra without
   reusing Admin live query embedding configuration or exposing secrets.
2. Extend the shared Mastra provider helper so gateway-native vectors keep the
   existing 1536-dimensional Admin ingest contract. Current production
   native-1536 responses pass through without a client transform; the generic
   4096-to-1536 truncation/re-normalization path remains covered for future
   gateway variants that truly return 4096.
3. Keep transcript, scene, and experience workflows using the shared provider
   helper and type-specific Admin ingest endpoints.
4. Add provider metadata and validation coverage so malformed gateway responses,
   non-finite values, count mismatches, post-transform dimension drift, and
   unexpected gateway model/native-dimension output fail before Admin ingest.
5. Extend the Mastra search-eval release gate so this migration explicitly
   requires assigned judge configuration, passing judge calibration,
   non-negative net win rate, no clear Tier-1 regression signal, enough
   comparable evidence, and Admin-side provider/transform provenance from the
   gateway-backed local vector generation run.
6. Persist the full migration eval report JSON under
   `docs/search-eval-reports/` with sanitized content and enough run metadata
   for review.
7. Extend the operator backfill surface so a single coordinated action can
   cover transcript, scene, and experience embeddings while preserving
   type-level reporting, failure isolation, idempotent reruns, and explicit
   repair, force, and model-upgrade modes. Production all-content backfill must
   validate a passed migration gate report before running.
8. Validate locally against a prod-like Admin restore before production
   replacement. Production backfill is blocked until the eval gate passes.

## Implementation Notes - 2026-06-03

- Mastra content embedding provider config now supports the Jesus Film AI
  Gateway through `MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE=gateway` and
  `AI_GATEWAY_EMBEDDINGS_*` env vars. Production gateway mode requires a key
  and rejects non-HTTPS or non-allowlisted gateway hosts before credentials can
  be sent.
- The shared Mastra provider helper requests the normal gateway embedding
  response without a `dimensions` field and validates provider
  shape/count/order before workflow handoff. Earlier local validation used a
  4096-native gateway response and transformed it to 1536; current production
  gateway mode is native 1536 and records `embedding_transform_version=NULL`.
- Transcript, scene, and experience workflows send provider/model/native
  dimensions/transform provenance through their existing type-specific Admin
  ingest contracts.
- Admin persists provider and transform provenance on transcript, scene-locale,
  and experience-locale embedding owner rows while keeping vector columns and
  public search contracts unchanged.
- The Mastra release gate requires an assigned judge, non-skipped passing
  calibration, enough comparable evidence, non-negative net win rate, and no
  configured loss/search/judge/disagreement failures.
- `apps/mastra/src/scripts/run-content-embedding-search-eval.ts` writes the
  sanitized `content-search-eval-gate-report` JSON under
  `docs/search-eval-reports/`.
- `apps/admin/src/scripts/run-embeds.ts --pipeline=all` runs scene,
  transcript, and experience branches and requires a passed gate report before
  all-content replacement. `--pipeline=both` remains the old scene+transcript
  pair for compatibility.

## Operator Sequence

1. Merge the native-1536 provenance fix, deploy Admin and Mastra production,
   and verify both services are running the merged commit before generating a
   new gate report or starting production backfill.
2. Verify the production gateway/env tuple without printing secrets:
   `jesus-film-ai-gateway`, model/request model `embeddings`, native
   dimensions `1536`, final dimensions `1536`, and `transformVersion: null`.
3. Generate gateway-backed content vectors against a prod-like local Admin
   restore.
4. Run the content embedding search-eval gate:

   ```bash
   pnpm --filter @forge/mastra eval:content-embedding-gate -- \
     --baseline-name=prod-seed-baseline-YYYY-MM-DD \
     --environment-label=local
   ```

5. Review and commit the sanitized JSON at
   `docs/search-eval-reports/<reportId>.json`.
6. Only after the gate report has `gate.backfillReady=true`, run the
   all-content backfill:

   ```bash
   pnpm --filter @forge/admin run-embeds \
     --pipeline=all \
     --scene-mode=model-upgrade \
     --transcript-mode=model-upgrade \
     --experience-mode=model-upgrade \
     --gate-report=docs/search-eval-reports/<reportId>.json \
     --report-out=.tmp/prod-embeds/content-ai-gateway-backfill.json
   ```

## Production Go/No-Go Checklist

Before `--pipeline=all`, create a verified database backup or vector export
that can restore `video_transcript`, `video_transcript_chunk`,
`video_scene_locale`, and `experience_locale` to the pre-backfill state.
Record the backup/export id beside the eval report id.

Pre-backfill baselines:

```sql
SELECT COUNT(*) AS video_transcripts FROM video_transcript;
SELECT COUNT(*) AS transcript_chunks FROM video_transcript_chunk;
SELECT COUNT(*) AS scene_locales FROM video_scene_locale;
SELECT COUNT(*) AS experience_locales_with_vectors
FROM experience_locale
WHERE embedding IS NOT NULL;
```

After the Prisma migration deploys, verify the additive provenance columns
exist:

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'video_transcript',
    'video_scene_locale',
    'experience_locale'
  )
  AND column_name IN (
    'embedding_provider',
    'embedding_native_dimensions',
    'embedding_transform_version'
  )
ORDER BY table_name, column_name;
```

Post-backfill provenance checks:

```sql
SELECT embedding_provider, embedding_native_dimensions,
       embedding_transform_version, COUNT(*)
FROM video_transcript
WHERE embedding_provider IS NOT NULL
GROUP BY 1, 2, 3;

SELECT embedding_provider, embedding_native_dimensions,
       embedding_transform_version, COUNT(*)
FROM video_scene_locale
WHERE embedding IS NOT NULL
GROUP BY 1, 2, 3;

SELECT embedding_provider, embedding_native_dimensions,
       embedding_transform_version, COUNT(*)
FROM experience_locale
WHERE embedding IS NOT NULL
GROUP BY 1, 2, 3;
```

Zero-mismatch checks:

```sql
SELECT COUNT(*) AS mismatched_video_transcripts
FROM video_transcript
WHERE embedding_provider IS DISTINCT FROM 'jesus-film-ai-gateway'
   OR model IS DISTINCT FROM 'embeddings'
   OR dimensions IS DISTINCT FROM 1536
   OR embedding_native_dimensions IS DISTINCT FROM 1536
   OR embedding_transform_version IS NOT NULL;

SELECT COUNT(*) AS mismatched_scene_locales
FROM video_scene_locale
WHERE embedding IS NOT NULL
  AND (
    embedding_provider IS DISTINCT FROM 'jesus-film-ai-gateway'
    OR model IS DISTINCT FROM 'embeddings'
    OR dimensions IS DISTINCT FROM 1536
    OR embedding_native_dimensions IS DISTINCT FROM 1536
    OR embedding_transform_version IS NOT NULL
  );

SELECT COUNT(*) AS mismatched_experience_locales
FROM experience_locale
WHERE embedding IS NOT NULL
  AND (
    embedding_provider IS DISTINCT FROM 'jesus-film-ai-gateway'
    OR embedding_model IS DISTINCT FROM 'embeddings'
    OR embedding_dimensions IS DISTINCT FROM 1536
    OR embedding_native_dimensions IS DISTINCT FROM 1536
    OR embedding_transform_version IS NOT NULL
  );
```

Expected gateway rows for the current production contract should show
`jesus-film-ai-gateway`, native dimensions `1536`, final stored dimensions
`1536`, and `embedding_transform_version IS NULL`. Every mismatch count above
must be zero, and gateway-qualified row counts should be compared with the
saved pre-backfill baselines and the `run-embeds.complete` report before
declaring the migration complete. If a rollback is needed, restore from the
recorded backup/export first, then rerun the pre-backfill baselines and compare
counts before reopening the migration gate.

## Initial Validation Status - 2026-06-03

This section records the pre-merge worktree state. The later commits and
artifacts cited in the completion decision supersede it.

- Code-level validation in this worktree passed for the gateway provider
  transform, Mastra workflow handoffs, Admin ingest provenance, sanitized eval
  gate export, and gated all-content backfill script.
- The full Mastra local eval suite and content backfill have not been run from
  this shell because the required local/prod-like runtime env is absent:
  `DATABASE_URL`, `AI_GATEWAY_EMBEDDINGS_API_KEY`,
  `ADMIN_SEARCH_EVAL_SEARCH_URL`, `ADMIN_SEARCH_EVAL_API_KEY`,
  `OPENROUTER_API_KEY`, manager S3 env, and Mastra service/ingest keys were all
  unset.
- No `docs/search-eval-reports/<reportId>.json` migration result is committed
  yet. The first completed eval run, passing or failing, should write the
  sanitized full JSON report there before production content replacement.

## Constraints

- Do not move Admin live query embedding generation to the gateway in this
  ticket.
- Do not move pgvector storage, indexes, or ingest contracts away from 1536
  dimensions.
- Do not change public search REST, GraphQL response shapes, or vector exposure
  boundaries.
- Do not move live search orchestration into Mastra.
- Do not add a generic Admin embedding blob endpoint; transcript, scene, and
  experience ingest stay type-specific.
- Do not commit secrets, raw production trace rows, credentials, cookies, IP
  addresses, user identifiers, raw source/query text, raw vectors, or provider
  payloads in the eval report artifact.
- Do not retune ranking unless the validation report exposes a blocking
  regression that must be fixed before backfill.
- Do not run production all-content vector replacement without a verified
  rollback point or vector export.

## Verification

- Mastra provider tests prove current native-1536 gateway responses stay
  finite and 1536-dimensional before workflow handoff, while the generic
  4096-to-1536 transform path remains covered for future gateway variants.
- Transcript, scene, and experience workflow tests prove the shared provider
  result still threads vectors by input position and reports provider metadata
  safely.
- The Mastra search-eval orchestrator refuses migration release-gate success
  when judge configuration is missing, calibration is skipped or failed,
  net win rate is negative, comparable coverage is insufficient, any evaluated
  locale lacks comparable judged queries, or configured failure thresholds are
  exceeded. Gateway corpus provenance is stored on Admin
  transcript, scene-locale, and experience-locale rows and should be checked
  alongside the local backfill report for the evaluated restore.
- A full JSON eval report is written under `docs/search-eval-reports/` and
  passes schema/redaction checks.
- The coordinated backfill action can run all three content embedding types and
  still reports type-level success, skip, failure, and retry details after
  validating a passed gate report for production runs.
- Admin live query embedding tests and public search contract tests remain
  unchanged in behavior.
