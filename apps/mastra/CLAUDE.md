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
- Do not import from `apps/admin`, `apps/manager`, or `apps/auth`; workflow
  contracts are HTTP payloads plus local Zod schemas.
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

## Environment

| Variable                                  | Purpose                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | Postgres connection string for Mastra runtime storage. Required in production runtime.                                        |
| `MASTRA_SERVICE_API_KEYS`                 | CSV allowlist for service bearer calls. Required in production runtime.                                                       |
| `MASTRA_NATIVE_EVAL_ENVIRONMENT`          | Optional label for native search-eval Dataset and Experiment names. Defaults to Mastra environment.                           |
| `MASTRA_CONTENT_EMBEDDINGS_PROVIDER_MODE` | Selects content embedding provider posture: `gateway` or `legacy`. Production and gateway-key env imply `gateway`.            |
| `AI_GATEWAY_EMBEDDINGS_API_KEY`           | Mastra-owned Jesus Film AI Gateway embeddings key. Required when content provider mode resolves to `gateway`.                 |
| `AI_GATEWAY_EMBEDDINGS_BASE_URL`          | OpenAI-compatible AI Gateway embeddings base URL. Defaults to `https://ai-gateway.jesusfilm.org/v1`.                          |
| `AI_GATEWAY_EMBEDDINGS_ALLOWED_HOSTS`     | Production allowlist for gateway credential egress. Defaults to `ai-gateway.jesusfilm.org`.                                   |
| `AI_GATEWAY_EMBEDDINGS_USER_AGENT`        | Non-default user agent for AI Gateway embedding requests. Defaults to `forge-mastra-content-embeddings/1.0`.                  |
| `AI_GATEWAY_EMBEDDINGS_MODEL`             | Model sent to the AI Gateway embeddings endpoint. Defaults to `embeddings`.                                                   |
| `AI_GATEWAY_EMBEDDINGS_PROVIDER`          | Provider provenance label sent through Admin ingest metadata. Defaults to `jesus-film-ai-gateway`.                            |
| `MASTRA_STORAGE_DIR`                      | Optional directory for Studio-visible observability/log files. Defaults to `$RAILWAY_VOLUME_MOUNT_PATH/mastra` on Railway.    |
| `MASTRA_STORAGE_BACKEND`                  | Mastra runtime storage backend. Use `postgres` normally; `memory` is local/test-only and rejected in production.              |
| `OPENROUTER_API_KEY`                      | OpenRouter key for locale-quality eval query generation and offline compare judging. Required for compare mode.               |
| `OPENROUTER_EMBEDDINGS_BASE_URL`          | Optional OpenRouter-compatible embedding base URL. Defaults to OpenRouter's `/api/v1` endpoint.                               |
| `OPENAI_API_KEY`                          | Fallback model provider key for smoke agent/model-routed calls and transcript embeddings when OpenRouter is unavailable.      |
| `OPENAI_EMBEDDINGS_BASE_URL`              | Optional OpenAI-compatible embedding provider base URL. Defaults to OpenAI's `/v1` endpoint.                                  |
| `TRANSCRIPT_EMBEDDING_MODEL`              | Model stamp for transcript embeddings. Defaults to `openai/text-embedding-3-small`.                                           |
| `TRANSCRIPT_EMBEDDING_PROVIDER`           | Provider stamp for transcript embeddings. Defaults to `openai`.                                                               |
| `SCENE_EMBEDDING_MODEL`                   | Model stamp for scene embeddings. Defaults to `openai/text-embedding-3-small`.                                                |
| `SCENE_EMBEDDING_PROVIDER`                | Provider stamp for scene embeddings. Defaults to `openai`.                                                                    |
| `EXPERIENCE_EMBEDDING_MODEL`              | Model stamp for experience embeddings. Defaults to `openai/text-embedding-3-small`.                                           |
| `EXPERIENCE_EMBEDDING_PROVIDER`           | Provider stamp for experience embeddings. Defaults to `openai`.                                                               |
| `FIRECRAWL_API_KEY`                       | Firecrawl key for the Instagram AI/Christian discovery workflow. Optional; the workflow returns `config_missing` when absent. |
| `FIRECRAWL_API_BASE_URL`                  | Firecrawl API base URL. Defaults to `https://api.firecrawl.dev`.                                                              |
| `FIRECRAWL_SEARCH_TIMEOUT_MS`             | Per-request timeout for Firecrawl search in ms. Defaults to `60000`.                                                          |
| `INSTAGRAM_DISCOVERY_ARTIFACT_DIR`        | Directory for Instagram discovery report JSON artifacts. Defaults to `<storage>/instagram-discovery`.                         |
| `EVAL_QUERY_GENERATION_MODEL`             | OpenRouter chat model stamp for locale-quality eval query generation. Defaults to `anthropic/claude-haiku-4-5`.               |
| `ADMIN_TRANSCRIPT_INGEST_URL`             | Admin internal transcript ingest endpoint. Required in production runtime.                                                    |
| `ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY`  | Bearer key Mastra presents to Admin transcript ingest. Required in production runtime.                                        |
| `ADMIN_SCENE_INGEST_URL`                  | Admin internal scene ingest endpoint. Required in production runtime.                                                         |
| `ADMIN_MASTRA_SCENE_INGEST_API_KEY`       | Bearer key Mastra presents to Admin scene ingest. Required in production runtime.                                             |
| `ADMIN_EXPERIENCE_INGEST_URL`             | Admin internal experience ingest endpoint. Required in production runtime.                                                    |
| `ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY`  | Bearer key Mastra presents to Admin experience ingest. Required in production runtime.                                        |
| `ADMIN_SEARCH_TRACE_SAMPLE_URL`           | Admin internal trace sample endpoint for eval query generation. Required only when running that workflow.                     |
| `ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL`   | Admin internal compact catalog context endpoint for eval query generation. Required only when running that workflow.          |
| `ADMIN_SEARCH_EVAL_CANDIDATES_URL`        | Admin internal generated-candidate storage endpoint for eval query generation. Required only when running that workflow.      |
| `ADMIN_SEARCH_EVAL_SEARCH_URL`            | Admin internal no-trace search endpoint for offline search eval. Required only when running the offline eval workflow.        |
| `ADMIN_SEARCH_EVAL_API_KEY`               | Bearer key Mastra presents to Admin search-eval routes. Must match Admin's dedicated sampling/eval key allowlist.             |
| `MASTRA_SEARCH_EVAL_ARTIFACT_DIR`         | Optional directory for Mastra-owned offline search eval baseline and report JSON artifacts. Defaults under Mastra storage.    |
| `MASTRA_SEARCH_EVAL_ALLOW_PROD_IMPORT`    | Set to `true` only for an intentional production import override. Defaults to `false`; local imports do not need it.          |
| `SEARCH_EVAL_JUDGE_MODEL`                 | OpenRouter chat model stamp for offline search eval judging. Defaults to `anthropic/claude-haiku-4-5`.                        |
| `PORT`                                    | Railway-provided runtime port. Mastra defaults to `4111` locally.                                                             |
| `MASTRA_STUDIO_PATH`                      | Set to `.mastra/output/studio` when starting the built server with Studio assets.                                             |

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
operator run the seed baseline from Studio without hand-written JSON:
`mode=capture-baseline`, `baselineName=seed-baseline`, all seeded locales,
`searchLimit=20`, `searchMode=hybrid`, and `contentType=all`. Use explicit
`all` options for filter enums when Studio should run both corpora; avoid
nullable defaults because Studio renders them as awkward `OR` controls.

Admin remains the live search authority. Mastra never queries Admin Postgres,
never imports Admin code, never generates live query embeddings, and never
enters the public search request path. The Studio-facing offline eval workflow
is seed-only for now. Generated candidates from the feat-138 staging table are
not exposed as operator inputs, are not stored in baselines, and do not become
regression gates.

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

Native record names include the environment label, for example
`search-eval:local:seed-baseline`, and native metadata carries stable keys for
idempotent reruns. Re-running a report sync should update Dataset items by
source key and reuse the existing report Experiment instead of duplicating
records.

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

Default `seed-baseline` mode captures the committed seed prompt baseline named
`seed-baseline`, requires native report sync, rejects candidate generation,
rejects seed-candidate submission, rejects promoted-candidate sync, and runs a
readiness preflight before touching Admin search. Use explicit `full` mode for
broader operator runs that coordinate generation/review/promoted-sync leaf
workflows. `compare` mode compares current search against an existing baseline,
and `release-gate` mode adds explicit pass/fail thresholds for losses, search
failures, judge failures, judge disagreements, and calibration.
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
  "searchMode": "hybrid",
  "contentType": "all",
  "generateCandidates": false,
  "submitSeedCandidates": false,
  "nativeSync": true,
  "syncPromoted": false
}
```

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
**Firecrawl web search** (`POST /v1/search`) — Instagram is heavily gated, so
direct crawling is unreliable; search returns post/reel URLs plus title/snippet
that the keyword heuristic acts on.

Input is Studio-friendly with defaults (runs with no hand-written JSON):
`queries` (defaults to two Instagram-targeted AI/Christian queries),
`limitPerQuery` (10), `scrapeMetadata` (false — set true to scrape each hit for
richer metadata, slower), `maxResults` (50), `persistArtifact` (true). The
workflow searches each query (tolerant to per-query failures), parses Instagram
permalinks, dedupes by shortcode, and keeps only posts whose caption/hashtags
signal **both** AI-generation and Christian content.

Results are returned in the response and, by default, written to a validated
JSON artifact under `INSTAGRAM_DISCOVERY_ARTIFACT_DIR`
(`<storage>/instagram-discovery/reports/<runId>.json`).

Limitations to keep in mind:

- **Keyword classification is heuristic and noisy.** It flags keyword signals,
  not verified AI-generation or Christian intent. An optional LLM confirmation
  step is deferred follow-up work.
- **`publishedAt` is best-effort.** Instagram rarely exposes a reliable
  timestamp through search snippets, so it is frequently `null` unless scrape
  metadata includes it.

Failure reasons: `invalid_input` (400), `config_missing` (503, when
`FIRECRAWL_API_KEY` is unset), `all_queries_failed` (502, only when every query
errors). Firecrawl is an opt-in tool — its env vars are optional and are not
part of `assertMastraRuntimeEnv()`.

## Railway Storage

Production `@forge/mastra` uses the existing Mastra Postgres database through
`DATABASE_URL` as the default runtime store. Studio-visible observability/log
data uses Mastra's supported DuckDB store under `MASTRA_STORAGE_DIR`, backed by
the Railway volume mounted at `/data`.
If `MASTRA_STORAGE_DIR` is not set, the app derives `/data/mastra` from
Railway's built-in `RAILWAY_VOLUME_MOUNT_PATH=/data`.

Keep `PinoLogger` configured as the app logger so runtime logs continue to flow
to stdout/stderr for Railway's platform logs.
