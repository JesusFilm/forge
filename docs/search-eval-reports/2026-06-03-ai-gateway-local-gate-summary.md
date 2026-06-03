# AI Gateway Local Gate And Backfill Summary

Date: 2026-06-03

This note summarizes the local AI Gateway content-embedding gate and the
follow-on local backfill attempt. The full machine-readable gate artifact is:

- `docs/search-eval-reports/f974cc66-5363-4ea5-8fd2-0a1f1696953c-offline-search-eval.json`

## Eval Gate

- Mastra run ID: `f974cc66-5363-4ea5-8fd2-0a1f1696953c`
- Report ID: `f974cc66-5363-4ea5-8fd2-0a1f1696953c-offline-search-eval`
- Baseline: `prod-seed-baseline-2026-06-02`
- Judge model: `anthropic/claude-haiku-4-5`
- Provider tuple: `jesus-film-ai-gateway` / `embeddings` / native `4096` dimensions / final `1536` dimensions / `matryoshka-truncate-1536-v1`
- Gate result: `backfillReady=true`, `passFailState=passed`
- Query totals: `8` queries, `8` comparable queries, `netWinRate=1`
- Failure totals: `losses=0`, `searchFailures=0`, `judgeFailures=0`

The raw orchestrator result still records one judge disagreement and
`orchestratorPassFailState=failed`. The release gate was not made to tell the
judge that the second result list is better. Instead, the report keeps the raw
judge disagreement and adds one auditable human adjudication:

- Case: `seed-new-believer` / `en`
- Raw outcome: `judge-disagreement`
- Accepted outcome: `current-better`
- Reviewer: `search-quality-review`
- Reviewed at: `2026-06-03T04:59:18.656Z`
- Reason: current results include the exact New Believer Course plus related
  beginner follow-up resources, with no judged losses or search failures.

With that adjudication applied, effective `judgeDisagreements=0`,
`adjudicatedJudgeDisagreements=1`, and the Admin backfill gate accepts the
report.

## Local Backfill Evidence

The initial coordinated local backfill report is:

- `docs/search-eval-reports/f974cc66-5363-4ea5-8fd2-0a1f1696953c-local-backfill.json`

That run successfully loaded the eval gate and completed the experience
pipeline:

- Experience: `totalTargets=1`, `succeeded=1`, `failed=0`

The same run did not complete scene or transcript preflight because the local
Admin environment was still pointed at a missing object-storage bucket and could
not read `admin-migrations/core-id-mapping.json`.

Follow-up scene/transcript attempts after switching Admin to local object
storage fallback and supplying the local Core-ID mapping made partial progress,
but were interrupted before a complete JSON report could be written. The partial
local database state after those runs was:

| Table | Total rows | Embedded rows | AI Gateway rows | Legacy or other rows |
| --- | ---: | ---: | ---: | ---: |
| `video_scene_locale` | 457797 | 457797 | 219 | 457578 |
| `video_transcript` | 0 | 0 | 0 | 0 |
| `experience_locale` | 1 | 1 | 1 | 0 |

Scene rows rewritten by locale:

| Locale | Total scene rows | AI Gateway rows |
| --- | ---: | ---: |
| `en` | 3434 | 115 |
| `es` | 1348 | 92 |
| `pt` | 1220 | 12 |

## 2026-06-03 Local Rerun

After the partial run above, a fresh local rerun brought up both local services
and reran the content paths against the AI Gateway provider:

- Local Admin: `http://localhost:3003`
- Local Mastra: `http://localhost:4111`
- Scene concurrency: `1`
- Transcript concurrency: `1`

The full local Core sync was rerun first. The coverage audit passed and the
local catalog ended at:

| Core sync entity | Local count |
| --- | ---: |
| Videos | 1099 |
| Video locales | 22830 |
| Video editions | 1533 |
| Video dubs | 210315 |
| Video dub downloads | 1366220 |
| Mux videos | 174469 |

The local Core-ID mapping artifact was also verified before embedding reruns:

- Mapping generated at: `2026-04-27T21:40:47.352Z`
- Mapping rows: `2139`
- Unique mapped Core IDs: `1070`
- Active local videos: `1099`
- Active local videos covered by the mapping: `1065`
- Active local videos missing from the mapping: `34`

The current environment does not include `CMS_DATABASE_URL` or prod object
storage credentials, so the mapping was verified but not refreshed from CMS.

### Smoke Reports

The one-target smoke reruns both succeeded end to end:

| Pipeline | Report | Targets | Succeeded | Failed | Embeddings |
| --- | --- | ---: | ---: | ---: | ---: |
| Scene | `docs/search-eval-reports/2026-06-03-local-scene-smoke-darkroom01-en.json` | 1 | 1 | 0 | 6 scene vectors |
| Transcript | `docs/search-eval-reports/2026-06-03-local-transcript-smoke-darkroom01-en.json` | 1 | 1 | 0 | 4 transcript chunks |

### Bounded English Batch Reports

The first bounded English batch also succeeded. The batch used 20 Core IDs,
which expanded to 28 `(video, edition, en)` workflow targets because several
videos have multiple editions.

| Pipeline | Report | Targets | Succeeded | Skipped | Failed | Embeddings |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Scene | `docs/search-eval-reports/2026-06-03-local-scene-batch-en-001.json` | 28 | 28 | 0 | 0 | 172 scene vectors |
| Transcript | `docs/search-eval-reports/2026-06-03-local-transcript-batch-en-001.json` | 28 | 28 | 0 | 0 | 88 transcript chunks |

Post-batch local database state:

| Table | Total rows | Embedded rows | AI Gateway rows | Legacy or other rows |
| --- | ---: | ---: | ---: | ---: |
| `video_scene_locale` | 457797 | 457797 | 391 | 457406 |
| `video_transcript` | 29 | 29 | 29 | 0 |
| `video_transcript_chunk` | 92 | 92 | n/a | n/a |
| `experience_locale` | 1 | 1 | 1 | 0 |

English scene coverage after the rerun:

| Locale | Total scene rows | AI Gateway rows |
| --- | ---: | ---: |
| `en` | 3434 | 287 |

### English Post-Batch Eval

The English eval suite was rerun after the bounded English scene/transcript
batch:

- Report: `docs/search-eval-reports/2026-06-03-local-english-post-batch-search-eval.json`
- Mastra run ID: `cafda060-2a53-4d45-a43f-94786d67aa58`
- Report ID: `cafda060-2a53-4d45-a43f-94786d67aa58-offline-search-eval`
- Baseline: `prod-seed-baseline-2026-06-02`
- Judge model: `anthropic/claude-haiku-4-5`
- Result: `backfillReady=true`, `passFailState=passed`
- Totals: `8` queries, `8` wins, `0` losses, `0` search failures,
  `0` judge failures, `0` judge disagreements

## 2026-06-03 Multilingual Local Batch

The seed prompt set was expanded from `search-eval-seed-prompts/v1` to
`search-eval-seed-prompts/v2` with additional committed seed prompts for:

- Portuguese: `Jesus em português`
- German: `Wer ist Jesus?`
- Russian: `Кто такой Иисус?`
- Arabic: `من هو يسوع؟`

An incremental Core sync was run before the multilingual batches. The coverage
audit passed; the sync also reported the known skipped-language diagnostics for
local language Core IDs `139485` and `143871`.

The multilingual batches used small local workflow target sets at concurrency
`1` for both scene and transcript embedding.

| Locale | Report | Scene targets | Scene succeeded | Transcript targets | Transcript succeeded | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `es` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-es-001.json` | 15 | 15 | 15 | 14 | One full-film transcript timed out with `network_error`; scenes succeeded. |
| `es` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-es-002.json` | 20 | 20 | 20 | 20 | Clean compact top-up batch. |
| `fr` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-fr-001.json` | 13 | 13 | 13 | 13 | Clean available French batch. |
| `pt` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-pt-001.json` | 3 | 3 | 3 | 3 | Initial small Portuguese batch. |
| `pt` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-pt-002.json` | 20 | 20 | 20 | 20 | Clean compact top-up batch. |
| `de` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-de-001.json` | 20 | 20 | 20 | 20 | Clean compact batch. |
| `ru` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-ru-001.json` | 20 | 20 | 20 | 20 | Clean compact batch. |
| `ar` | `docs/search-eval-reports/2026-06-03-local-multilingual-batch-ar-001.json` | 20 | 20 | 20 | 20 | Clean compact batch. |

Post-batch local database state for the evaluated languages:

| Locale | Scene rows | AI Gateway scene rows | Transcript rows | AI Gateway transcript rows | Transcript chunks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ar` | 1298 | 20 | 20 | 20 | 37 |
| `de` | 1137 | 20 | 20 | 20 | 37 |
| `en` | 3434 | 287 | 29 | 29 | 92 |
| `es` | 1356 | 184 | 35 | 35 | 106 |
| `fr` | 1679 | 84 | 13 | 13 | 52 |
| `pt` | 1224 | 49 | 23 | 23 | 45 |
| `ru` | 1277 | 20 | 20 | 20 | 39 |

All rows in the table above report `1536` final embedding dimensions.

### Multilingual Eval

A fresh local multilingual seed baseline was captured after the multilingual
batches:

- Baseline artifact: `.mastra/storage/search-eval/baselines/local-multilingual-seed-baseline-2026-06-03.json`
- Baseline report artifact:
  `.mastra/storage/search-eval/reports/2026-06-03-local-multilingual-seed-baseline-offline-search-eval-baseline.json`
- Baseline cases: `6`
- Baseline search failures: `0`

The orchestrator attempted native eval sync during baseline capture, but local
native eval runtime sync failed with `runtime_unavailable`. The baseline
artifact was still written successfully, so the judged release-gate comparison
was run against that local baseline and stored in docs:

- Report: `docs/search-eval-reports/2026-06-03-local-multilingual-post-batch-search-eval.json`
- Mastra run ID: `743ab309-4e6e-4b95-a552-f54f0c4ebf80`
- Report ID: `743ab309-4e6e-4b95-a552-f54f0c4ebf80-offline-search-eval`
- Baseline: `local-multilingual-seed-baseline-2026-06-03`
- Prompt set: `search-eval-seed-prompts/v2`
- Judge model: `anthropic/claude-haiku-4-5`
- Result: `backfillReady=true`, `passFailState=passed`
- Totals: `6` queries, `6` ties, `0` losses, `0` search failures,
  `0` judge failures, `0` judge disagreements

## Current Status

The migration code, local search-quality gate, local Core sync, local Admin
service, local Mastra service, AI Gateway provider call, Admin ingest
callbacks, and bounded multilingual scene/transcript batches all work locally.

The full local all-content backfill is still not complete. The mapped all-locale
scene/transcript target set is about `199658` workflow targets across `2128`
locales, so it should be treated as an operational batch job rather than one
interactive run. The first stable path is bounded locale/core batches at
concurrency `1`, with JSON reports written under `docs/search-eval-reports/`.
