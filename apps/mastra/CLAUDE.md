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

| Variable                                 | Purpose                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | Postgres connection string for Mastra runtime storage. Required in production runtime.                                     |
| `MASTRA_SERVICE_API_KEYS`                | CSV allowlist for service bearer calls. Required in production runtime.                                                    |
| `MASTRA_STORAGE_DIR`                     | Optional directory for Studio-visible observability/log files. Defaults to `$RAILWAY_VOLUME_MOUNT_PATH/mastra` on Railway. |
| `OPENROUTER_API_KEY`                     | Preferred transcript embedding provider key; matches the repo's existing OpenRouter embedding convention.                  |
| `OPENROUTER_EMBEDDINGS_BASE_URL`         | Optional OpenRouter-compatible embedding base URL. Defaults to OpenRouter's `/api/v1` endpoint.                            |
| `OPENAI_API_KEY`                         | Fallback model provider key for smoke agent/model-routed calls and transcript embeddings when OpenRouter is unavailable.   |
| `OPENAI_EMBEDDINGS_BASE_URL`             | Optional OpenAI-compatible embedding provider base URL. Defaults to OpenAI's `/v1` endpoint.                               |
| `TRANSCRIPT_EMBEDDING_MODEL`             | Model stamp for transcript embeddings. Defaults to `openai/text-embedding-3-small`.                                        |
| `TRANSCRIPT_EMBEDDING_PROVIDER`          | Provider stamp for transcript embeddings. Defaults to `openai`.                                                            |
| `SCENE_EMBEDDING_MODEL`                  | Model stamp for scene embeddings. Defaults to `openai/text-embedding-3-small`.                                             |
| `SCENE_EMBEDDING_PROVIDER`               | Provider stamp for scene embeddings. Defaults to `openai`.                                                                 |
| `EXPERIENCE_EMBEDDING_MODEL`             | Model stamp for experience embeddings. Defaults to `openai/text-embedding-3-small`.                                        |
| `EXPERIENCE_EMBEDDING_PROVIDER`          | Provider stamp for experience embeddings. Defaults to `openai`.                                                            |
| `EVAL_QUERY_GENERATION_MODEL`            | OpenRouter chat model stamp for locale-quality eval query generation. Defaults to `anthropic/claude-haiku-4-5`.            |
| `ADMIN_TRANSCRIPT_INGEST_URL`            | Admin internal transcript ingest endpoint. Required in production runtime.                                                 |
| `ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY` | Bearer key Mastra presents to Admin transcript ingest. Required in production runtime.                                     |
| `ADMIN_SCENE_INGEST_URL`                 | Admin internal scene ingest endpoint. Required in production runtime.                                                      |
| `ADMIN_MASTRA_SCENE_INGEST_API_KEY`      | Bearer key Mastra presents to Admin scene ingest. Required in production runtime.                                          |
| `ADMIN_EXPERIENCE_INGEST_URL`            | Admin internal experience ingest endpoint. Required in production runtime.                                                 |
| `ADMIN_MASTRA_EXPERIENCE_INGEST_API_KEY` | Bearer key Mastra presents to Admin experience ingest. Required in production runtime.                                     |
| `ADMIN_SEARCH_TRACE_SAMPLE_URL`          | Admin internal trace sample endpoint for eval query generation. Required only when running that workflow.                  |
| `ADMIN_SEARCH_EVAL_CATALOG_CONTEXT_URL`  | Admin internal compact catalog context endpoint for eval query generation. Required only when running that workflow.       |
| `ADMIN_SEARCH_EVAL_CANDIDATES_URL`       | Admin internal generated-candidate storage endpoint for eval query generation. Required only when running that workflow.   |
| `ADMIN_SEARCH_EVAL_API_KEY`              | Bearer key Mastra presents to Admin search-eval routes. Must match Admin's dedicated sampling/eval key allowlist.          |
| `PORT`                                   | Railway-provided runtime port. Mastra defaults to `4111` locally.                                                          |
| `MASTRA_STUDIO_PATH`                     | Set to `.mastra/output/studio` when starting the built server with Studio assets.                                          |

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

## Railway Storage

Production `@forge/mastra` uses the existing Mastra Postgres database through
`DATABASE_URL` as the default runtime store. Studio-visible observability/log
data uses Mastra's supported DuckDB store under `MASTRA_STORAGE_DIR`, backed by
the Railway volume mounted at `/data`.
If `MASTRA_STORAGE_DIR` is not set, the app derives `/data/mastra` from
Railway's built-in `RAILWAY_VOLUME_MOUNT_PATH=/data`.

Keep `PinoLogger` configured as the app logger so runtime logs continue to flow
to stdout/stderr for Railway's platform logs.
