# Agent Prompt: Native-1536 Gateway Cleanup, Production Re-embed, and Evals

You are working in the Forge monorepo. Your goal is to finish the AI Gateway native-1536 embeddings migration and then run the production content enrichment/re-embedding/eval sequence end to end.

## Current Context

- Working tree: `/workspace/.worktrees/fix/ai-gateway-native-1536`
- Current branch with uncommitted fix: `fix/native-1536-provenance`
- The live endpoint `https://ai-gateway.jesusfilm.org/v1/embeddings` has been checked and returns:
  - `embedding_dimension: 1536`
  - unit norm around `1.0`
  - model: `embeddings`
- Earlier CE docs assumed `4096 native -> truncate to 1536`, but the current production gateway is already configured to emit native `1536`.
- Therefore current production provenance should be:
  - `provider: jesus-film-ai-gateway`
  - `model: embeddings`
  - `requestModel: embeddings`
  - `nativeDimensions: 1536`
  - `finalDimensions: 1536`
  - `transformVersion: null`

## Non-negotiables

1. Do not wipe or re-embed production until the native-1536 provenance code fix has merged to `main` and deployed successfully.
2. Do not print API keys, bearer tokens, database URLs, or secret env values.
3. Do not use `--allow-ungated-local-backfill` in production.
4. Do not mix vector spaces. Queries and stored vectors must use the same provider/source.
5. Do not touch `embedding_qwen` columns unless you first verify they are in scope. The current migration target is the main `embedding` content vector path.
6. Take or verify a fresh production DB backup before any destructive wipe.
7. Save all eval artifacts/reports under `docs/search-eval-reports/`, with a short Markdown summary and a JSON artifact pointer or full JSON as repo conventions require.
8. Treat the eval report's `contentEmbeddingProvider` tuple as necessary but not sufficient. Before production wipe/re-embed, also prove the evaluated Admin corpus rows carry the same provider/native-dimension/transform provenance, or add that proof to the eval/reporting path before proceeding.

## Phase 1: Finish the Native-1536 Code Contract

Inspect the current diff. It should show this intent:

- `apps/mastra/src/config/env.ts`
  - The gateway provider config should only pass `truncateToDimensions` and `transformVersion` when native dimensions differ from final dimensions.
  - Since native and final are both `1536`, current gateway config should not trigger client-side truncation.
- `apps/mastra/src/scripts/run-content-embedding-search-eval.ts`
  - The eval gate provider tuple should report `transformVersion: null` for native-1536.
- `apps/admin/src/scripts/run-embeds.ts`
  - The full backfill gate should require native `1536`, final `1536`, and `transformVersion: null`.
- Tests/fixtures should be updated accordingly.
- Keep the generic `4096 -> 1536` helper and tests in `apps/mastra/src/services/embedding-provider.ts`; it is future-proofing if the gateway ever returns true 4k again.

Run these checks:

```bash
pnpm --filter @forge/mastra exec vitest run \
  src/services/embedding-provider.test.ts \
  src/config/env.test.ts \
  src/services/offline-search-eval/report.test.ts \
  src/scripts/run-content-embedding-search-eval.test.ts

pnpm --filter @forge/admin exec vitest run src/scripts/run-embeds.test.ts

pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/admin typecheck
```

Then run Compound Engineering review/compound if available:

```text
Use compound-engineering:ce-code-review on the diff.
Apply any real findings.
Use compound-engineering:ce-compound to capture the learning if the repo needs a solution note update.
```

Commit, push, and open a PR. Monitor CI. Merge only once CI is green.

## Phase 2: Deploy and Verify Production Contract

After merge, monitor production deploys for the affected services. At minimum verify Admin and Mastra production deployments are using the merged commit.

Confirm required production env is present without printing values:

- Mastra:
  - `AI_GATEWAY_EMBEDDINGS_API_KEY`
  - `AI_GATEWAY_EMBEDDINGS_BASE_URL`
  - `AI_GATEWAY_EMBEDDINGS_MODEL`
  - `AI_GATEWAY_EMBEDDINGS_PROVIDER`
  - `MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE=gateway`
  - Admin ingest URLs/keys for transcript and experience embedding writes.
- Admin:
  - workflow/service keys needed by `run-embeds`
  - production DB URL
  - search/eval API keys and judge model env needed by the native eval suite.

Run a live dimension smoke with a normal user-agent and without printing the key:

```bash
python3 - <<'PY'
import json, math, os, urllib.request
url = os.environ["AI_GATEWAY_EMBEDDINGS_BASE_URL"].rstrip("/") + "/embeddings"
key = os.environ["AI_GATEWAY_EMBEDDINGS_API_KEY"]
req = urllib.request.Request(
    url,
    data=json.dumps({"model": "embeddings", "input": ["native 1536 production smoke"]}).encode(),
    headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "User-Agent": "curl/8.4",
    },
)
data = json.load(urllib.request.urlopen(req, timeout=30))
embedding = data["data"][0]["embedding"]
norm = math.sqrt(sum(x * x for x in embedding))
print(json.dumps({
    "model": data.get("model"),
    "dimension": len(embedding),
    "normRounded": round(norm, 6),
}, indent=2))
PY
```

Expected: `dimension` is `1536` and `normRounded` is about `1.0`.

## Phase 3: Baseline Production Counts Before Wipe

Before modifying production data, record counts and provenance distribution. Use the production DB connection, but do not print the raw connection string.

Useful count queries:

```sql
SELECT
  embedding_provider,
  embedding_native_dimensions,
  embedding_transform_version,
  COUNT(*) AS rows
FROM video_scene_locale
WHERE embedding IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY rows DESC;

SELECT
  vt.embedding_provider,
  vt.embedding_native_dimensions,
  vt.embedding_transform_version,
  COUNT(*) AS chunks
FROM video_transcript_chunk vtc
JOIN video_transcript vt ON vt.id = vtc.transcript_id
WHERE vtc.embedding IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY chunks DESC;

SELECT
  embedding_provider,
  embedding_native_dimensions,
  embedding_transform_version,
  COUNT(*) AS rows
FROM experience_locale
WHERE embedding IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY rows DESC;
```

Also count total eligible rows/targets for transcript and experience. Confirm multilingual coverage exists before assuming Core Sync is needed. Core Sync is not the default next step if production already has the videos/languages.

## Phase 4: Get a Fresh Native Eval Gate

Run the full Mastra native eval suite against the deployed native-1536 contract. The report must include:

- judge model
- native dimensions `1536`
- final dimensions `1536`
- transform version `null`
- pass/fail state
- multilingual coverage summary
- path to JSON artifact under `docs/search-eval-reports/`
- row-provenance evidence for the evaluated corpus, or a paired Admin SQL/report artifact proving the searched transcript and experience rows match the same native-1536 gateway tuple

Use the repo's existing eval command where possible:

```bash
pnpm --filter @forge/mastra eval:content-embedding-gate \
  --baseline-name=<appropriate-prod-baseline> \
  --environment-label=production \
  --out=docs/search-eval-reports/<report-id>.json
```

If exact flags differ, inspect `apps/mastra/src/scripts/run-content-embedding-search-eval.ts` and use the supported flags. Do not fabricate a gate report. If judge setup is missing, configure the judge and rerun rather than bypassing the gate.

Important caveat: the current docs gate records the active Mastra provider config, but the search response does not yet expose per-result embedding provenance. Do not interpret that config tuple alone as proof that every evaluated Admin row has already been rewritten. Pair the eval gate with the Phase 3/6 provenance SQL, or implement an Admin internal provenance summary endpoint and wire it into the Mastra report before authorizing destructive production work.

## Phase 5: Production Wipe and Re-embed

Only proceed after:

- the native-1536 provenance PR is merged
- the deploy is verified
- a fresh production backup exists
- the eval gate report is backfill-ready

Prefer existing workflow modes that safely overwrite stale vectors. If a hard wipe is still required by the operator, wipe only embedding/provenance fields or workflow-owned embedding rows, not source content, and do it in the smallest practical transaction/window. Review exact SQL against `apps/admin/prisma/schema.prisma` immediately before executing.

Target tables/columns to reason about:

- Transcript vectors: `video_transcript_chunk.embedding`; transcript-level provenance is on `video_transcript.embedding_provider`, `embedding_native_dimensions`, `embedding_transform_version`, `source_*`, `generation_mode`, `mastra_run_id`.
- Experience vectors: `experience_locale.embedding` plus `embedding_*` provenance fields.
- Historical scene rows: retained for feat-199 only; do not wipe or backfill them as part of transcript/experience content replacement.

Then run the production backfill with the gate report:

```bash
pnpm --filter @forge/admin run-embeds \
  --pipeline=all \
  --gate-report=docs/search-eval-reports/<report-id>.json \
  --transcript-mode=model-upgrade \
  --experience-mode=model-upgrade \
  --report-out=.tmp/prod-native-1536-run-embeds-<timestamp>.json
```

If the run reports missing transcript artifacts, use the existing enrichment trigger flow:

```bash
pnpm --filter @forge/admin trigger-enrichment \
  --kind=transcript \
  --from-report=.tmp/prod-native-1536-run-embeds-<timestamp>.json
```

Wait for enrichment to finish, then rerun `run-embeds` until transcript and experience backfills complete or failures are isolated and explained.

## Phase 6: Post-backfill Verification

After re-embedding, verify:

- Transcript chunks are populated and parent transcript provenance is native `1536`, transform `NULL`.
- Experience locale rows are populated and provenance is native `1536`, transform `NULL`.
- Multilingual languages expected from the seeded/synced production corpus are represented.
- Search health and representative multilingual queries work.

Use the same provenance SQL from Phase 3 and include before/after counts in the final report.

Run the full Mastra native eval suite again after the backfill. Save:

- Markdown summary under `docs/search-eval-reports/`
- JSON artifact under `docs/search-eval-reports/` or a local JSON pointer, matching repo convention
- Clear statement of whether multilingual quality improved, regressed, or stayed neutral
- Any residual failures with exact workflow/run IDs

## Final Response Requirements

Report back with:

1. PR/commit/deploy status.
2. Whether production gateway returns native `1536`.
3. Whether the wipe happened, and exactly what was wiped.
4. How many transcript and experience embeddings were regenerated.
5. Which enrichment workflows ran and their outcomes.
6. Eval report paths and pass/fail summary.
7. Multilingual coverage/quality summary.
8. Any remaining blockers or follow-up tickets.

Be direct and do not claim the migration is complete unless the production re-embed and post-backfill evals are actually complete.
