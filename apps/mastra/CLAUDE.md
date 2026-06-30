# apps/mastra -- Mastra Runtime

## What this app does

Self-hosted Mastra Server runtime for Forge agents and workflows. It deploys to
Railway as an internal service and serves Mastra Studio assets alongside the API
after `mastra build --studio`.

Origin documents:

- Requirements: `docs/brainstorms/2026-05-22-mastra-railway-workflow-runtime-requirements.md`
- Plan: `docs/plans/2026-05-22-001-feat-mastra-railway-runtime-plan.md`
- Roadmap: `docs/roadmap/platform/feat-129-mastra-railway-workflow-runtime.md`

## Stack

- Mastra Server (`@mastra/core` + `mastra` CLI)
- TypeScript strict mode
- Vitest for focused unit tests
- Railway deployment

## Architecture rules

- `apps/mastra-gateway` owns human Studio authentication and access management.
- `apps/mastra` owns runtime execution only: agents, workflows, service bearer
  validation, and safe health/smoke surfaces.
- The transcript embedding workflow owns transcript chunk planning and embedding
  provider calls, then submits vectors to Admin's transcript ingest.
- The scene embedding workflow owns scene description embedding provider calls,
  retry/failure visibility, and Studio diagnostics, then submits vectors to
  Admin's scene-specific ingest. Admin remains the owner of pgvector storage,
  indexes, target resolution, public search contracts, and search retrieval.
- The experience embedding workflow follows the same ownership split: Mastra
  generates and validates vectors, Admin stores them and serves retrieval.
- The eval query generation workflow is offline only. It reads compact Admin
  trace/catalog context over authenticated HTTP, generates catalog-derived,
  locale-quality, and trace-sampled candidates, and stores staged candidates
  back in Admin. It must not enter the live search path or promote candidates
  into permanent regression gates.
- Transcript, scene, and experience workflows share provider-result validation
  for count alignment, finite vector values, and configured dimensions. Invalid
  provider output must throw inside the workflow so Studio records a failed run.
- AI Gateway content embeddings request the normal OpenAI-compatible embedding
  response and require the configured native dimensions before Admin ingest.
  Current production gateway output is native 1536, so Mastra does not pass
  `dimensions` through LiteLLM and does not apply a client transform. Keep the
  shared 4096-to-1536 truncate/re-normalize helper for future gateway variants
  that truly return 4096.
- Transcript, scene, and experience workflows share Admin ingest transport
  behavior but keep separate Admin endpoints, local schemas, and type-specific
  payload parsing. Do not replace them with a generic embedding blob route.
- Generation mode semantics are shared across embedding workflows: omitted means
  idempotent; explicit `repair`, `force`, and `model-upgrade` request rewrites.
- Firecrawl web data access is Mastra-owned through bounded search/scrape
  tools, `webResearchAgent`, the `firecrawl-web-data` workflow, and the
  `/forge-firecrawl-web-data` service route. Keep direct Firecrawl credentials
  and API calls out of Admin and Manager.
- Subtitle enrichment execution is Mastra-owned through the
  `/forge-subtitle-enrichment` service route. Mastra reads Manager transcript
  artifacts, translates and retimes subtitles, writes
  `{assetId}/subtitles-{lang}.vtt` and `{assetId}/translation-{lang}.json` to
  shared artifact storage, and returns per-language results to Manager.
- Gospel-aware subtitle translation prompt steering also belongs in this
  runtime. Manager may send optional title, label, and Bible-reference context,
  but Mastra owns scripture-context detection, prompt guidance for Christian
  gospel/Bible-story content, and sanitized subtitle artifact provenance.
- Subtitle scripture accuracy validation is Mastra-owned too. For translated
  Bible-story subtitles it should run from model knowledge by default, upgrade
  to a configured target-language Bible text source when available, and fall
  back to `basis=model_knowledge` when that source is missing or fails. Store
  only sanitized validation findings and provenance, never full external Bible
  passage text.
- Source transcript scripture correction judgment is Mastra-owned through
  `/forge-transcript-scripture-correction`. It detects likely Bible-story
  source transcripts, returns bounded correction candidates and flag-only
  findings, and degrades provider/config failures to an unavailable correction
  result. Manager owns deterministic exact-match application, raw artifact
  preservation, canonical source artifact writes, and operator display.
- Do not import from `apps/admin`, `apps/manager`, or `apps/auth`; workflow
  contracts are HTTP payloads plus local Zod schemas. **Exception (consolidation
  U1):** the LLM experience-draft _generation contract_ is single-sourced from
  the shared `@forge/experience-schema` package (pure zod — `DraftExperienceSchema`,
  `SkeletonSchema`, fill schemas, `coerce-draft`, `extract-json-object`), consumed
  by BOTH the draft/chat generator here and admin's re-validator so the two sides
  cannot drift. This is a _shared generation contract_, not a per-service _wire_
  schema — the "local Zod schemas" rule still governs every `/forge-*` route's
  request/response shape.
- Experience draft-authoring + chat agents are Mastra-owned (consolidation
  U3–U9): the draft/chat agents + `multi-step-draft`/`quick-draft` workflows +
  repair run here; admin is a thin caller/proxy over authenticated HTTP. Admin
  keeps candidate retrieval, exemplar selection, draft re-validation,
  persistence/ABAC, chat history, and the 👍/👎 ratings store. See "Experience
  draft & chat generation" below.
- Keep service-bearer auth receiver-side. Callers present a bearer; this app
  validates explicit `/forge-*` service routes against
  `MASTRA_SERVICE_API_KEYS`; Studio's built-in `/api/workflows` routes must
  remain reachable by the Mastra runtime.
- Keep health checks unauthenticated and non-sensitive.

## Development

```bash
pnpm --filter @forge/mastra dev
pnpm --filter @forge/mastra build
pnpm --filter @forge/mastra start
pnpm --filter @forge/mastra test
pnpm --filter @forge/mastra typecheck
pnpm --filter @forge/mastra lint
```

### Why `dev` runs under `--import tsx`

`mastra dev` externalizes workspace deps (e.g. `@forge/experience-schema`) and
lets Node's loader resolve them at runtime. That package's `exports` point at
raw `.ts` source whose `index.ts` re-exports siblings **extensionlessly**
(`export * from "./experience-ai.schemas"`). Node's ESM resolver does not guess
extensions, so the default loader throws
`ERR_MODULE_NOT_FOUND … experience-ai.schemas` before the server can boot — it
is the first multi-file raw-`.ts` workspace package this runtime loads. The
`dev` script therefore sets `NODE_OPTIONS="--import tsx"` so tsx's loader (which
does resolve extensionless `.ts`) handles those imports, on **both** the CLI
analysis pass and the spawned dev server. Adding explicit `.ts` extensions to
the shared package instead would force `allowImportingTsExtensions` (TS5097)
into every consumer's tsconfig, and the repo's other packages all stay
extensionless — so the fix lives here, dev-only. `build`/`start` are unaffected:
the Rollup deployer transpiles the workspace package into the bundle.

## Environment

| Variable                                     | Purpose                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                               | Postgres connection string for Mastra runtime storage. Required in production runtime.                                                                                                                                                                                                                                                                      |
| `MASTRA_SERVICE_API_KEYS`                    | CSV allowlist for service bearer calls. Required in production runtime.                                                                                                                                                                                                                                                                                     |
| `MASTRA_NATIVE_EVAL_ENVIRONMENT`             | Optional label for native search-eval Dataset and Experiment names. Defaults to Mastra environment.                                                                                                                                                                                                                                                         |
| `SEEKER_ROUTE_ENABLED`                       | Default-off gate for the internal `POST /forge-seeker` SSE service route (feat-204). Optional, **no default** — the route returns 404 unless this is exactly `"true"` (repo string-boolean convention; `"false"`/unset = disabled). Never required at boot.                                                                                                 |
| `MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE`    | Selects content embedding provider posture: `gateway` or `legacy`. Production and gateway-key env imply `gateway`.                                                                                                                                                                                                                                          |
| `AI_GATEWAY_EMBEDDINGS_API_KEY`              | Mastra-owned Jesus Film AI Gateway embeddings key. Required when content provider mode resolves to `gateway`.                                                                                                                                                                                                                                               |
| `AI_GATEWAY_EMBEDDINGS_BASE_URL`             | OpenAI-compatible AI Gateway embeddings base URL. Defaults to `https://ai-gateway.jesusfilm.org/v1`.                                                                                                                                                                                                                                                        |
| `AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS`        | Production allowlist for gateway credential egress. Defaults to `ai-gateway.jesusfilm.org`.                                                                                                                                                                                                                                                                 |
| `AI_GATEWAY_EMBEDDINGS_USER_AGENT`           | Non-default user agent for AI Gateway embedding requests. Defaults to `forge-mastra-content-embeddings/1.0`.                                                                                                                                                                                                                                                |
| `AI_GATEWAY_EMBEDDINGS_MODEL`                | Model sent to the AI Gateway embeddings endpoint. Defaults to `embeddings`.                                                                                                                                                                                                                                                                                 |
| `AI_GATEWAY_EMBEDDINGS_PROVIDER`             | Provider provenance label sent through Admin ingest metadata. Defaults to `jesus-film-ai-gateway`.                                                                                                                                                                                                                                                          |
| `MASTRA_STORAGE_DIR`                         | Optional directory for Studio-visible observability/log files. Defaults to `$RAILWAY_VOLUME_MOUNT_PATH/mastra` on Railway.                                                                                                                                                                                                                                  |
| `MASTRA_STORAGE_BACKEND`                     | Mastra runtime storage backend. Use `postgres` normally; `memory` is local/test-only and rejected in production. Omitting it for local Studio dev with no reachable Postgres crashes the server at boot (uncaught `MASTRA_STORAGE_PG_CREATE_TABLE_FAILED` / `ECONNREFUSED` on `mastra_threads`) _after_ it prints "ready" — set `memory` for any local run. |
| `OPENROUTER_API_PAID_KEY`                    | Preferred OpenRouter key for eval generation, offline judging, and legacy embedding mode.                                                                                                                                                                                                                                                                   |
| `OPENROUTER_API_KEY`                         | Legacy OpenRouter fallback for those paths when `OPENROUTER_API_PAID_KEY` is absent.                                                                                                                                                                                                                                                                        |
| `OPENROUTER_EMBEDDINGS_BASE_URL`             | Optional OpenRouter-compatible embedding base URL. Defaults to OpenRouter's `/api/v1` endpoint.                                                                                                                                                                                                                                                             |
| `OPENAI_API_KEY`                             | Fallback model provider key for smoke agent/model-routed calls and transcript embeddings when OpenRouter is unavailable.                                                                                                                                                                                                                                    |
| `OPENAI_EMBEDDINGS_BASE_URL`                 | Optional OpenAI-compatible embedding provider base URL. Defaults to OpenAI's `/v1` endpoint.                                                                                                                                                                                                                                                                |
| `TRANSCRIPT_EMBEDDING_MODEL`                 | Model stamp for transcript embeddings. Defaults to `openai/text-embedding-3-small`.                                                                                                                                                                                                                                                                         |
| `TRANSCRIPT_EMBEDDING_PROVIDER`              | Provider stamp for transcript embeddings. Defaults to `openai`.                                                                                                                                                                                                                                                                                             |
| `SCENE_EMBEDDING_MODEL`                      | Model stamp for scene embeddings. Defaults to `openai/text-embedding-3-small`.                                                                                                                                                                                                                                                                              |
| `SCENE_EMBEDDING_PROVIDER`                   | Provider stamp for scene embeddings. Defaults to `openai`.                                                                                                                                                                                                                                                                                                  |
| `EXPERIENCE_EMBEDDING_MODEL`                 | Model stamp for experience embeddings. Defaults to `openai/text-embedding-3-small`.                                                                                                                                                                                                                                                                         |
| `EXPERIENCE_EMBEDDING_PROVIDER`              | Provider stamp for experience embeddings. Defaults to `openai`.                                                                                                                                                                                                                                                                                             |
| `EVAL_QUERY_GENERATION_MODEL`                | OpenRouter chat model stamp for locale-quality eval query generation. Defaults to `anthropic/claude-haiku-4-5`.                                                                                                                                                                                                                                             |
| `SUBTITLE_ENRICHMENT_MODEL`                  | OpenRouter chat model stamp for subtitle translation/retiming. Defaults to `google/gemini-2.5-flash`.                                                                                                                                                                                                                                                       |
| `SUBTITLE_ENRICHMENT_TIMEOUT_MS`             | Per-provider-call timeout for subtitle enrichment. Defaults to `120000`, max `300000`.                                                                                                                                                                                                                                                                      |
| `SUBTITLE_ENRICHMENT_CONCURRENCY`            | Max concurrent target languages per subtitle enrichment run. Defaults to `10`, max `25`.                                                                                                                                                                                                                                                                    |
| `TRANSCRIPT_SCRIPTURE_CORRECTION_MODEL`      | OpenRouter chat model stamp for source transcript scripture correction. Defaults to `SUBTITLE_ENRICHMENT_MODEL`.                                                                                                                                                                                                                                            |
| `TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS` | Per-provider-call timeout for source transcript scripture correction. Defaults to `120000`, max `300000`.                                                                                                                                                                                                                                                   |
| `SUBTITLE_VALIDATION_BIBLE_PROVIDER`         | Optional subtitle validation Bible text provider. Supported value: `api_bible`; unset keeps model-knowledge validation.                                                                                                                                                                                                                                     |
| `SUBTITLE_VALIDATION_BIBLE_MAP_JSON`         | Optional JSON map from target language code to provider Bible id, for example `{"en":"de4e12af7f28f599-02"}`.                                                                                                                                                                                                                                               |
| `API_BIBLE_API_KEY`                          | Optional API.Bible key used only when subtitle validation is configured to fetch target-language Bible passage text.                                                                                                                                                                                                                                        |
| `API_BIBLE_BASE_URL`                         | Optional API.Bible-compatible base URL. Defaults to `https://api.scripture.api.bible/v1`.                                                                                                                                                                                                                                                                   |
| `API_BIBLE_ALLOWED_HOSTS`                    | Production allowlist for API.Bible credential egress. Defaults to `api.scripture.api.bible`.                                                                                                                                                                                                                                                                |
| `RAILWAY_S3_ENDPOINT`                        | Railway Object Storage endpoint used for Manager-compatible subtitle artifacts when `RAILWAY_S3_BUCKET` is set.                                                                                                                                                                                                                                             |
| `RAILWAY_S3_REGION`                          | Railway Object Storage region. Defaults to `auto`.                                                                                                                                                                                                                                                                                                          |
| `RAILWAY_S3_BUCKET`                          | Shared artifact bucket. Required with access keys for production subtitle enrichment.                                                                                                                                                                                                                                                                       |
| `RAILWAY_S3_ACCESS_KEY_ID`                   | Shared artifact bucket access key for subtitle enrichment writes.                                                                                                                                                                                                                                                                                           |
| `RAILWAY_S3_SECRET_ACCESS_KEY`               | Shared artifact bucket secret key for subtitle enrichment writes.                                                                                                                                                                                                                                                                                           |
| `ADMIN_TRANSCRIPT_INGEST_URL`                | Admin internal transcript ingest endpoint. Required in production runtime.                                                                                                                                                                                                                                                                                  |
| `ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY`     | Bearer key Mastra presents to Admin transcript ingest. Required in production runtime.                                                                                                                                                                                                                                                                      |
| `ADMIN_SCENE_INGEST_URL`                     | Admin internal scene ingest endpoint. Required in production runtime.                                                                                                                                                                                                                                                                                       |
| `ADMIN_MASTRA_SCENE_INGEST_API_KEY`          | Bearer key Mastra presents to Admin scene ingest. Required in production runtime.                                                                                                                                                                                                                                                                           |
| `ADMIN_EXPERIENCE_INGEST_URL`                | Admin internal experience ingest endpoint. Required in production runtime.                                                                                                                                                                                                                                                                                  |
| `ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY`     | Bearer key Mastra presents to Admin experience ingest. Required in production runtime.                                                                                                                                                                                                                                                                      |
| `ADMIN_SEARCH_TRACE_SAMPLE_URL`              | Admin internal trace sample endpoint for eval query generation. Required only when running that workflow.                                                                                                                                                                                                                                                   |
| `ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL`      | Admin internal compact catalog context endpoint for eval query generation. Required only when running that workflow.                                                                                                                                                                                                                                        |
| `ADMIN_SEARCH_EVAL_CANDIDATES_URL`           | Admin internal generated-candidate storage endpoint for eval query generation. Required only when running that workflow.                                                                                                                                                                                                                                    |
| `ADMIN_SEARCH_EVAL_SEARCH_URL`               | Admin internal no-trace search endpoint for offline search eval. Required only when running the offline eval workflow.                                                                                                                                                                                                                                      |
| `ADMIN_SEARCH_EVAL_API_KEY`                  | Bearer key Mastra presents to Admin search-eval routes. Must match Admin's dedicated sampling/eval key allowlist.                                                                                                                                                                                                                                           |
| `MASTRA_SEARCH_EVAL_ARTIFACT_DIR`            | Optional directory for Mastra-owned offline search eval baseline and report JSON artifacts. Defaults under Mastra storage.                                                                                                                                                                                                                                  |
| `MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT`       | Set to `true` only for an intentional production import override. Defaults to `false`; local imports do not need it.                                                                                                                                                                                                                                        |
| `SEARCH_EVAL_JUDGE_MODEL`                    | OpenRouter chat model stamp for offline search eval judging. Defaults to `anthropic/claude-haiku-4-5`.                                                                                                                                                                                                                                                      |
| `SMART_CROP_PLAN_MODEL`                      | OpenRouter vision model for smart-crop plan intents. Defaults to `qwen/qwen2.5-vl-72b-instruct`.                                                                                                                                                                                                                                                            |
| `SMART_CROP_QA_MODEL`                        | OpenRouter vision model for smart-crop preview QA. Defaults to `google/gemini-2.5-flash`.                                                                                                                                                                                                                                                                   |
| `SMART_CROP_IMAGE_URL_ALLOWED_HOSTS`         | CSV host allowlist for smart-crop frame URLs. Defaults to `image.mux.com`.                                                                                                                                                                                                                                                                                  |
| `FIRECRAWL_API_KEY`                          | Firecrawl bearer key for Mastra-owned web search/scrape tools. Required in production runtime.                                                                                                                                                                                                                                                              |
| `FIRECRAWL_API_URL`                          | Firecrawl API base URL. Defaults to `https://api.firecrawl.dev`; production must use HTTPS and an allowlisted host.                                                                                                                                                                                                                                         |
| `FIRECRAWL_ALLOWED_HOSTS`                    | CSV host allowlist for production Firecrawl egress. Defaults to `api.firecrawl.dev`.                                                                                                                                                                                                                                                                        |
| `FIRECRAWL_USER_AGENT`                       | Non-default user agent for Firecrawl requests. Defaults to `forge-mastra-firecrawl/1.0`.                                                                                                                                                                                                                                                                    |
| `FIRECRAWL_TIMEOUT_MS`                       | Default Firecrawl request timeout. Defaults to `60000`.                                                                                                                                                                                                                                                                                                     |
| `FIRECRAWL_MAX_SEARCH_RESULTS`               | Runtime cap for Firecrawl search results exposed to agents/workflows. Defaults to `5`, max `20`.                                                                                                                                                                                                                                                            |
| `FIRECRAWL_MAX_MARKDOWN_CHARS`               | Runtime cap for markdown returned by Firecrawl search hydration and scrape. Defaults to `16000`.                                                                                                                                                                                                                                                            |
| `INSTAGRAM_DISCOVERY_ARTIFACT_DIR`           | Directory for Instagram discovery report JSON artifacts. Defaults to `<storage>/instagram-discovery`.                                                                                                                                                                                                                                                       |
| `JESUSFILM_RAG_BASE_URL`                     | Base URL of the JesusFilm RAG retrieval service for the seeker agent. Optional — unset degrades the tool to an explicit `unavailable` result, never a boot failure.                                                                                                                                                                                         |
| `JESUSFILM_RAG_API_KEY`                      | Per-consumer bearer token Mastra presents to the RAG. Optional; absent → tool returns `unavailable` (`config_missing`) at runtime. Never required at boot.                                                                                                                                                                                                  |
| `JESUSFILM_RAG_ALLOWED_HOSTS`                | CSV host allowlist for the RAG base URL. No default. In production, a set base URL requires https AND its host in this list, else boot throws (fail-closed security guard).                                                                                                                                                                                 |
| `JESUSFILM_RAG_TIMEOUT_MS`                   | Single-attempt RAG request timeout. Defaults to `5000`, schema-capped at `30000`.                                                                                                                                                                                                                                                                           |
| `JESUSFILM_RAG_MAX_RESPONSE_BYTES`           | Byte-cap on the buffered RAG response body (feat-202), applied to both the success and error-path reads. Streamed byte counter aborts the stream past the cap → graceful `unavailable`. Optional, defaults to `2097152` (2 MiB), schema-capped at 16 MiB (`16777216`). Never required at boot.                                                              |
| `JESUSFILM_RAG_USER_AGENT`                   | User agent identifying this consumer in RAG access logs. Defaults to `forge-mastra-jesusfilm-rag/1.0`.                                                                                                                                                                                                                                                      |
| `PORT`                                       | Railway-provided runtime port. Mastra defaults to `4111` locally.                                                                                                                                                                                                                                                                                           |
| `MASTRA_STUDIO_PATH`                         | Set to `.mastra/output/studio` when starting the built server with Studio assets.                                                                                                                                                                                                                                                                           |

## Eval query generation

The service route `POST /forge-eval-query-generation` is protected by
`MASTRA_SERVICE_API_KEYS` and launches the `eval-query-generation` workflow.
Input may optionally restrict `sources` to any of `catalog`, `locale_quality`,
or `trace`, plus `locales`, `traceLimit`, `catalogLimit`, and
`localeQueryCount`.

Admin remains the data owner. Mastra calls only the configured Admin HTTP
contracts, validates responses with local Zod schemas, and stores generated
candidates as staged Admin rows with source, locale, provenance, source
anchors, advisory judge summary, generation model/provider, Mastra run id, and
promotion status. Trace-derived candidates keep Admin's raw trace expiry so the
retention job can remove them before the 30-day ceiling.

## Offline search eval

The service route `POST /forge-offline-search-eval` is protected by
`MASTRA_SERVICE_API_KEYS` and launches the `offline-search-eval` workflow.
Supported modes are `capture-baseline` and `compare`. Baseline capture runs the
Mastra-owned seed prompt set against Admin's internal no-trace search endpoint,
then stores a named baseline artifact under the Mastra eval artifact directory.
Comparison runs load a named baseline, call Admin search again, judge
baseline-vs-current results with A/B swap calibration, and write a report
artifact.

Keep this workflow Studio-friendly: the workflow and first step must expose a
strict structured input schema, not `z.unknown()`. Defaults should let an
operator run the public Watch seed baseline from Studio without hand-written
JSON: `mode=capture-baseline`, `callerTrack=public-watch`, all seeded locales,
`searchLimit=20`, and `contentType=all`. `baselineName` and `searchMode` may
be omitted so the runner applies caller-track defaults:

- `public-watch`: `baselineName=seed-baseline`, `searchMode=keyword-first`.
- `ai-experience-generation`:
  `baselineName=seed-baseline-ai-experience-generation`,
  `searchMode=hybrid`.
- `semantic-diagnostic`: `baselineName=seed-baseline-semantic-diagnostic`,
  `searchMode=semantic-only`.

Use explicit `all` options for filter enums when Studio should run both
corpora; avoid nullable defaults because Studio renders them as awkward `OR`
controls.

Admin remains the live search authority. Mastra never queries Admin Postgres,
never imports Admin code, never generates live query embeddings, and never
enters the public search request path. The Studio-facing offline eval workflow
is seed-only for now. Generated candidates from the feat-138 staging table are
not exposed as operator inputs, are not stored in baselines, and do not become
regression gates.

Search eval baselines and reports are caller-track aware. Legacy untracked
artifacts are normalized to `public-watch`; new captures refuse to overwrite a
baseline owned by a different `callerTrack`, and comparisons reject mismatched
baseline/current caller tracks before Admin search or judge calls.

## Native search eval suite

The service route `POST /forge-search-eval-native-suite` is protected by
`MASTRA_SERVICE_API_KEYS` and launches the `search-eval-native-suite` workflow.
The workflow projects safe search-eval reports and promoted Admin candidates
into native Mastra Evaluation records:

- `create-sample-report` writes a realistic local sample comparison report,
  syncs it into a native Dataset, registers the pairwise search scorer, starts
  a native Experiment, and writes the synced native ids back into the report
  artifact. This action is local/development only.
- `sync-report` loads an existing report artifact by `reportId`, syncs it into
  native Evaluation, and updates the report's `mastraEvaluation` projection.
- `sync-promoted` reads promoted candidates through Admin HTTP, then only syncs
  rows that are both `promotionStatus=promoted` and
  `sanitizationStatus=sanitized`.

Native record names include the environment label, caller track, and search
mode, for example
`search-eval:local:seed-baseline:public-watch:keyword-first`, and native
metadata carries stable keys for idempotent reruns. Re-running a report sync
should update Dataset items by source key and reuse the existing report
Experiment instead of duplicating records. Report-derived source keys include
both `track:<callerTrack>` and `mode:<searchMode>` so public, AI-agent, and
semantic-diagnostic evidence cannot overwrite each other.

For local Studio smoke without Postgres or Admin data, run Mastra with:

```bash
MASTRA_STORAGE_BACKEND=memory \
MASTRA_NATIVE_EVAL_ENVIRONMENT=local \
MASTRA_SERVICE_API_KEYS=local-mastra-service-key \
MASTRA_SEARCH_EVAL_ARTIFACT_DIR=.mastra/storage/search-eval \
pnpm --filter @forge/mastra dev
```

Open `http://localhost:4111/studio/workflows/search-eval-native-suite`, run the
default `create-sample-report` action, then inspect Studio's native Evaluation
Datasets, Scorers, and Experiments.

## Search eval orchestrator

The service route `POST /forge-search-eval-orchestrator` is protected by
`MASTRA_SERVICE_API_KEYS` and launches the `search-eval-orchestrator` workflow.
It is a thin coordinator over the existing search eval leaf workflows:
`eval-query-generation`, `offline-search-eval`,
`search-eval-candidate-review`, and `search-eval-native-suite`.

Default `seed-baseline` mode captures the committed public Watch seed prompt
baseline named `seed-baseline`, requires native report sync, rejects candidate
generation, rejects seed-candidate submission, rejects promoted-candidate sync,
and runs a readiness preflight before touching Admin search. Pass
`callerTrack=ai-experience-generation` or `callerTrack=semantic-diagnostic` to
capture or compare the caller-specific prompt suites and baseline names. Use
explicit `full` mode for broader operator runs that coordinate
generation/review/promoted-sync leaf workflows. `compare` mode compares current
search against an existing baseline, and `release-gate` mode adds explicit
pass/fail thresholds for losses, search failures, judge failures, judge
disagreements, and calibration.
`resumeReportId` skips offline search execution and retries native report sync
for an existing report artifact.

For the AI Gateway content embedding migration, run the release gate through
the local helper so the sanitized gate JSON is written under
`docs/search-eval-reports/`:

```bash
pnpm --filter @forge/mastra eval:content-embedding-gate -- \
  --baseline-name=prod-seed-baseline-YYYY-MM-DD \
  --environment-label=local
```

The helper requires an assigned judge, non-skipped passing calibration,
non-negative net win rate, at least one comparable query, and no configured
loss/search/judge/disagreement failures before it exits zero. The emitted JSON
has `kind=content-search-eval-gate-report`, embeds the sanitized comparison
report and orchestrator summary, and stamps the evaluated content embedding
provider as Jesus Film AI Gateway `embeddings` with 1536 native dimensions,
1536 final dimensions, and `transformVersion: null` for the current production
gateway contract. That JSON is the gate artifact consumed by Admin's
`run-embeds --pipeline=all --gate-report=docs/search-eval-reports/<id>.json`.

Candidate generation and seed candidate submission are explicit opt-ins. The
orchestrator must never promote generated, trace-derived, seed, or
user-submitted candidates; promotion remains a human review action through
Admin HTTP contracts.

For production seed capture, call the orchestrator with either `{}` or an
explicit seed-only payload:

```json
{
  "mode": "seed-baseline",
  "baselineName": "prod-seed-baseline-YYYY-MM-DD",
  "callerTrack": "public-watch",
  "searchMode": "keyword-first",
  "contentType": "all",
  "generateCandidates": false,
  "submitSeedCandidates": false,
  "nativeSync": true,
  "syncPromoted": false
}
```

## Smart crop workflows

Smart crop (plan: `docs/plans/2026-06-09-002-feat-smart-crop-plan.md`) splits
ownership across three apps; Mastra owns the AI decisions only. Manager owns
job orchestration, artifact storage addressing, and Mux; crop-worker owns
ffprobe/FFmpeg and S3 bytes. This runtime never touches S3 or Mux credentials —
frames arrive as caller-provided, host-allowlisted https URLs
(`SMART_CROP_IMAGE_URL_ALLOWED_HOSTS`, default `image.mux.com`; https only,
exact hostname match).

**Production precondition for QA:** the `smart-crop-qa` route receives
presigned Railway S3 URLs for preview frames, so production must extend
`SMART_CROP_IMAGE_URL_ALLOWED_HOSTS` with the Railway S3 endpoint hostname
(the host of manager's `RAILWAY_S3_ENDPOINT`) alongside `image.mux.com`.
Without it the QA route rejects every frame with `frame_host_not_allowed`;
manager degrades that to a skipped QA step rather than a failed job, but no
QA report is produced.

Three bounded synchronous workflows, each with a service route protected by
`MASTRA_SERVICE_API_KEYS`:

- `smart-crop-plan` / `POST /forge-smart-crop-plan` — one OpenRouter vision
  call covering up to 8 shots (max 3 frame URLs each) produces per-shot crop
  intents; the deterministic planner (`smart-crop-planner-v1`,
  `src/services/smart-crop/planner.ts`) converts intents into 9:16 crop
  keyframes (full source height, even crop width, 8% dead zone, 240 px/s max
  pan scaled by source width, center fallback below confidence 0.5,
  slide_aware stays static centered in MVP). When a primary human face/head is
  visible, plan/repair intents carry `faceVisible: true` plus `faceCenter`; the
  planner anchors horizontally on that face center before falling back to the
  broader `subjectCenter`.
- `smart-crop-align` / `POST /forge-smart-crop-align` — pure deterministic
  alignment (`src/services/smart-crop/alignment.ts`) between canonical and
  localized `smart-crop-fingerprint` artifacts: tier-1 identical-duration or
  tier-2 monotonic shot-sequence matching (duration similarity + dhash
  Hamming), plus confidence gates with stable failure literals. No model call.
- `smart-crop-qa` / `POST /forge-smart-crop-qa` — one OpenRouter vision call
  reviews up to 8 rendered preview frames against the plan summary and returns
  `pass | needs_repair | fail` plus structured issues.

Results use a discriminated `{ ok: true, ... } | { ok: false, reason,
retryable, message, mastraRunId }` envelope with the shared reasons
`invalid_input | provider_config_missing | provider_auth_failed |
provider_failed | provider_invalid_output | frame_host_not_allowed`. The
planner and alignment modules are pure functions — keep them free of I/O and
env reads so they stay property-testable.

## Firecrawl web data

Firecrawl web data access is Mastra-owned. The runtime exposes:

- `webResearchAgent`, with `firecrawlSearch` and `firecrawlScrape` tools.
- `firecrawl-web-data`, a Studio-friendly workflow for either `search` or
  `scrape` actions.
- `POST /forge-firecrawl-web-data`, protected by `MASTRA_SERVICE_API_KEYS`, for
  internal service callers that need bounded web data without direct Firecrawl
  credentials.

Default route payloads:

```json
{ "action": "search", "query": "firecrawl mastra tools", "limit": 5 }
```

```json
{ "action": "scrape", "url": "https://docs.firecrawl.dev" }
```

The integration uses Firecrawl API v2 search and scrape over HTTPS, returns
bounded markdown, and maps upstream failures into safe structured result
objects. Keep direct Firecrawl calls out of Admin and Manager; those apps should
use this runtime's tools/workflow/route if they need web data. Do not add
Firecrawl MCP as the production path unless a later plan proves a real
multi-tool MCP server need; MCP can be useful for local operator convenience but
is not the deterministic product contract here.

## Seeker agent

`seekerAgent` (feat-198, feat-199) is the first conversational agent of the
planned "Jesus Film AI Chat" system, **Studio-only**, proving the
chat -> tool-call -> remembered-context shape: citation-disciplined
instructions with a mandatory safety line, the `retrieveAnswer` tool backed by
the JesusFilm RAG service (feat-199), and per-agent in-memory `Memory`. The tool
returns ranked, cited **passages** (`{ status, sources, message? }`) and the
agent's own LLM synthesizes the source-attributed answer — the tool generates
nothing. When the RAG env vars are unset (or the service is unreachable), the
tool returns an explicit `unavailable` status and the agent says it cannot
ground an answer; retrieval is never required for the app to boot. Model is
`openrouter/google/gemma-4-31b-it:free` (OpenRouter —
auto-reads `OPENROUTER_API_KEY`); the other agents stay on `openai/...`, so both
keys are needed. Memory lives in `src/mastra/memory.ts`, owns its own `InMemoryStore`
(never persists), and is mirrored — never imported — from admin (see that
file's header for the why).

### Local run

The seeker agent's model routes through OpenRouter, so `OPENROUTER_API_KEY` must
be set. Then:

```bash
MASTRA_STORAGE_BACKEND=memory pnpm --filter @forge/mastra dev
```

Without `JESUSFILM_RAG_BASE_URL` + `JESUSFILM_RAG_API_KEY` set, `retrieveAnswer`
returns `status: "unavailable"` and the agent tells the tester it cannot ground
an answer (graceful degradation — no boot failure). With both configured (and,
in production, the host allowlisted), open `/studio/agents/seekerAgent`: ask a
factual question (watch `retrieveAnswer` fire and return real cited passages),
then a follow-up to see thread recall. The agent must cite only source names and
URLs present in the returned passages. Use a **distinct `threadId` per tester** —
memory is process-lifetime in-memory and leaks across testers on a shared thread.

### Containment (read before exposing this anywhere)

The agent is reachable on Mastra's built-in, code-unauthenticated `/api/agents/*`
surface to anyone who can reach the Mastra endpoint. "Studio-only" is the
`apps/mastra-gateway` + Railway **network** boundary, **NOT** the
`seeker-route-isolation.test.ts` guard (which now pins the single
default-off `/forge-seeker` exposure and that no OTHER route wires the agent in
— see "Service route" below). The safety line bounds leaked-output blast radius; the
`redactPromptBodies` processor blanks span `input`/`output` in traces. Do not
expose to a public surface before the deferred guardrail gate AND a gateway
access decision.

### Service route (`POST /forge-seeker`, feat-204)

Internal, server-to-server dogfooding route that streams the seeker over a
stable bearer-gated contract (handler: `agents/seeker-route.ts`,
`handleSeekerRouteRequest`). It mirrors `/forge-experience-chat` but adds
per-session memory keying and `retrieveAnswer` `sources[]` extraction. Frames:
`token_delta {text}` → terminal `result {text, sources, grounded, producedBy}`,
or `error {reason}` (fixed-vocabulary reason only — no raw text on the wire).

- **Default-off**: gated on `SEEKER_ROUTE_ENABLED === "true"`, checked FIRST →
  404 when disabled (KTD7). It is **more** locked down than the built-in
  `/api/agents/*` surface, not a replacement for the network boundary.
- **Body**: `{ prompt, threadId }` required; `resourceId` optional + opaque.
  The route ALWAYS supplies a memory `resource` (the caller's `resourceId` else
  the constant `SEEKER_DEFAULT_RESOURCE_ID = "seeker-dogfood"`) because a
  memory-configured agent throws `AGENT_MEMORY_MISSING_RESOURCE_ID` at runtime
  when a `threadId` arrives without one. Isolation rides on `threadId`.
- **Budget**: `TIME_BUDGET_MS.chatTurn` (90s) + `STEP_CAPS.toolCallingTurn` (8),
  composed with the inbound request signal. No CORS, no `error.message` on wire.
- Scope is `apps/mastra` only; chat-app wiring is feat-205. The
  `seeker-route-isolation.test.ts` guard is re-pinned to this single route.

### Routing convention — call `/forge-seeker`, never `/api/agents/seekerAgent` (feat-202)

Apps and services that reach the seeker MUST call the bearer-gated
`POST /forge-seeker` route — **never** Mastra's built-in
`/api/agents/seekerAgent` surface, which is code-unauthenticated and carries no
per-request budget (no wall-clock `chatTurn`, and only the constructor-default
`maxSteps` floor feat-202 added — no route-composed step/time budget). `/forge-seeker`
adds the default-off gate, per-session memory keying, fixed-vocabulary error
frames, and the composed `chatTurn` + `toolCallingTurn` budget.

This is an **honor-system convention, not enforcement.** It does not close the
unauthenticated surface — the binding containment is and stays the
network/gateway boundary (`apps/mastra-gateway` + Railway networking; see
"Containment" above). The feat-202 constructor `maxSteps` floor is its
defense-in-depth companion (it bounds the runaway-loop dimension on the direct
path) but is overridable and not a substitute for routing through `/forge-seeker`.
A CI grep asserting no first-party caller references `/api/agents/seekerAgent`
could harden this into a real check later (deferred, not built).

### Not wired yet (deferred)

- **Full persona + safety guardrails** (a release gate) — fabrication/honesty,
  AI-disclosure, doctrinal-uncertainty, and **crisis handling** (suicidal-
  ideation / self-harm / acute distress -> route to human/helpline, never
  improvise). `seeker-agent.ts` carries a single commented guardrail
  attach-point breadcrumb marking where these hook.
- **Public-facing web surface** — `apps/mastra` is internal/service-bearer-only.
- **Postgres-persisted memory** — admin already proves that path; the skeleton
  stays in-memory.
- **Agent evals** — faithfulness/groundedness once RAG lands; safety scoring
  tied to the guardrail gate.

## Experience draft & chat generation

Mastra owns the AI experience **draft-authoring** + **chat** generation
(consolidation plan
`docs/plans/2026-06-19-001-feat-mastra-admin-to-standalone-consolidation-plan.md`).
Admin computes candidates + exemplar (its pgvector/embeddings), ships them over
the wire, and persists/re-validates the result; Mastra is the LLM generator.

- **Agents** (`src/mastra/agents/`): `experience-default-chat` (chat) +
  `draft-experience` / `add-section` / `rewrite-copy` (chat-facing specialized)
  - `experience-planner` / `experience-skeleton` / `experience-fill` /
    `experience-critic` / `experience-reviser` (workflow-only, memory-less) +
    `auto-enrich` (registered/Studio-invocable; no live dispatch). The chat-facing
    agents carry HTTP-backed tool callbacks; the workflow agents stay TOOL-LESS
    (candidates arrive pre-loaded in the workflow input, so they never tool-call).
- **Workflows** (`src/mastra/workflows/multi-step-draft.ts`): `multi-step-draft`
  (plan → skeleton → fill → critique → revise) and `quick-draft` (no revise) +
  `repair-draft.ts` (re-runs `experience-reviser` on a normalize-shaped error,
  decoupled from admin's normalize class via a local `NormalizationErrorLike`
  shape).
- **Memory**: `experience-chat` Postgres memory in `src/mastra/memory.ts`
  (alongside the seeker's in-memory store), gated on the gateway EMBEDDINGS key
  for semantic recall.
- **Service routes** (all `MASTRA_SERVICE_API_KEYS`-gated):
  - `POST /forge-experience-draft` — buffered; runs a draft workflow and
    returns `{ ok:true, draft } | { ok:false, reason, retryable }`. Internal
    `AbortSignal.timeout(TIME_BUDGET_MS.multiStepWorkflow)` (180s); admin's
    caller budget is strictly larger.
  - `POST /forge-experience-chat` — **streaming** (the only streaming `/forge-*`
    route): `experience-default-chat.stream()` → SSE `token_delta` frames + a
    terminal `result { text, producedBy }` (or `error { reason }`). An internal
    `AbortSignal.timeout(chatTurn)` (90s) composed with the inbound request
    signal + `reader.cancel()` on disconnect cancels the agent run, so a closed
    editor tab stops generation through both legs.
- **Agent tool callbacks** (`src/services/admin-agent-tools-client.ts`): the
  chat agent's `searchVideos` / `lookupBibleVerse` / `fetchVideoImage` tools call
  admin's bearer-gated `/api/internal/agent-tools/*` over HTTP (never admin
  Prisma). `ADMIN_AGENT_TOOLS_URL` + `ADMIN_AGENT_TOOLS_API_KEY` (optional;
  unset → the tool degrades to an empty result, never a boot/turn failure).

| Variable                                  | Purpose                                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_GATEWAY_CHAT_*`                       | JesusFilm gateway chat-model factory (opt-in via `AI_GATEWAY_CHAT_ENABLED="true"`).                                                                                                       |
| `GOOGLE_GENERATIVE_AI_API_KEY`            | Default structured-chat provider (Gemini 3.5 Flash) when set.                                                                                                                             |
| `MASTRA_DEFAULT_PROVIDER`                 | Default provider id (`openrouter` fallback).                                                                                                                                              |
| `AI_GATEWAY_CONSTRAINED_DECODING_TRUSTED` | Gates per-phase schema-constrained decoding (default `"false"`).                                                                                                                          |
| `ADMIN_AGENT_TOOLS_URL`                   | Admin base URL for the chat agent's tool callbacks. Optional.                                                                                                                             |
| `ADMIN_AGENT_TOOLS_API_KEY`               | Bearer admin holds in its `ADMIN_AGENT_TOOLS_API_KEYS` receiver CSV. Optional.                                                                                                            |
| `ADMIN_AGENT_TOOLS_TIMEOUT_MS`            | Per-tool single-attempt timeout (default 10s, cap 30s — fits the 90s chatTurn).                                                                                                           |
| `ADMIN_AGENT_TOOLS_ALLOWED_HOSTS`         | Optional SSRF allowlist (CSV) for the admin base host, checked before any call. Unset → operator-set host trusted (`redirect:"error"` still guards); set → enforced, else `ssrf_blocked`. |

## Search eval baseline portability

The service route `POST /forge-search-eval-baseline-portability` is protected
by `MASTRA_SERVICE_API_KEYS` and launches the
`search-eval-baseline-portability` workflow. It provides three actions:

- `preflight` checks the production Admin search URL, Admin eval bearer,
  service bearer allowlist, non-memory production storage, database URL,
  persistent artifact root, and an artifact write/read/delete probe.
- `export-baseline` reads a Mastra-owned baseline plus up to three report ids,
  validates that every prompt/result came from the committed seed prompt set,
  then returns a bounded sanitized JSON artifact.
- `import-baseline` validates the artifact and writes report artifacts before
  writing the baseline marker, so a partial import is not activated as the
  current local baseline.

Production imports are disabled by default through
`MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT=false`. Export from production, store the
returned JSON artifact in the approved secure handoff location, then import it
into local Mastra so native Evaluation and local artifacts can compare future
search work against the same seed snapshot without logging into production.

## Instagram AI/Christian discovery

The service route `POST /forge-instagram-discovery` is protected by
`MASTRA_SERVICE_API_KEYS` and launches the `instagram-ai-christian-discovery`
workflow. It discovers AI-generated Christian videos on Instagram using
the shared **Firecrawl web search** client (`POST /v2/search`) — Instagram is
heavily gated, so direct crawling is unreliable; search returns post/reel URLs
plus title/snippet that the keyword heuristic acts on.

Input is Studio-friendly with defaults (runs with no hand-written JSON):
`queries` (defaults to two Instagram-targeted AI/Christian queries),
`limitPerQuery` (5, max 20), `scrapeMetadata` (false — set true to request bounded
markdown hydration for each search hit, slower), `maxResults` (50),
`persistArtifact` (true). The
workflow searches each query (tolerant to per-query failures), parses Instagram
permalinks, dedupes by shortcode, and keeps only posts whose caption/hashtags
signal **both** AI-generation and Christian content **and** do not read as
commentary/news/tutorial (a conservative `COMMENTARY_KEYWORDS` exclusion in
`classifier.ts`, e.g. "should we", "here's my", "tutorial", "went viral"). The
report's `totals.excludedCommentary` counts posts dropped by that filter.

Results are returned in the response and, by default, written to a validated
JSON artifact under `INSTAGRAM_DISCOVERY_ARTIFACT_DIR`
(`<storage>/instagram-discovery/reports/<runId>.json`).

Limitations to keep in mind:

- **Keyword classification is heuristic and noisy.** It flags keyword signals,
  not verified AI-generation or Christian intent. The commentary exclusion filter
  removes obvious news/tutorial/reaction posts, but a meaning-aware LLM relevance
  check is deferred follow-up work.
- **`publishedAt` is best-effort.** Instagram rarely exposes a reliable
  timestamp through search snippets, so it is frequently `null` unless scrape
  metadata includes it.

Failure reasons: `invalid_input` (400), `config_missing` (503, when
`FIRECRAWL_API_KEY` is unset in a non-production/dev-style runtime),
`all_queries_failed` (502, only when every query errors), `artifact_failed`
(500, when report persistence fails). Production already requires the shared
Firecrawl env vars for Mastra's web-data surface.

## Railway Storage

Production `@forge/mastra` uses the existing Mastra Postgres database through
`DATABASE_URL` as the default runtime store. Studio-visible observability/log
data uses Mastra's supported DuckDB store under `MASTRA_STORAGE_DIR`, backed by
the Railway volume mounted at `/data`.
If `MASTRA_STORAGE_DIR` is not set, the app derives `/data/mastra` from
Railway's built-in `RAILWAY_VOLUME_MOUNT_PATH=/data`.

Keep `PinoLogger` configured as the app logger so runtime logs continue to flow
to stdout/stderr for Railway's platform logs.
