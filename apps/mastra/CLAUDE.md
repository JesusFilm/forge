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
  provider calls, then submits vectors to Admin's transcript ingest. Admin
  remains the owner of pgvector storage, indexes, and public search retrieval.
- Keep service-bearer auth receiver-side. Callers present a bearer; this app
  validates against `MASTRA_SERVICE_API_KEYS`.
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
| `ADMIN_TRANSCRIPT_INGEST_URL`            | Admin internal transcript ingest endpoint. Required in production runtime.                                                 |
| `ADMIN_MASTRA_TRANSCRIPT_INGEST_API_KEY` | Bearer key Mastra presents to Admin transcript ingest. Required in production runtime.                                     |
| `PORT`                                   | Railway-provided runtime port. Mastra defaults to `4111` locally.                                                          |
| `MASTRA_STUDIO_PATH`                     | Set to `.mastra/output/studio` when starting the built server with Studio assets.                                          |

## Railway Storage

Production `@forge/mastra` uses the existing Mastra Postgres database through
`DATABASE_URL` as the default runtime store. Studio-visible observability/log
data uses Mastra's supported DuckDB store under `MASTRA_STORAGE_DIR`, backed by
the Railway volume mounted at `/data`.
If `MASTRA_STORAGE_DIR` is not set, the app derives `/data/mastra` from
Railway's built-in `RAILWAY_VOLUME_MOUNT_PATH=/data`.

Keep `PinoLogger` configured as the app logger so runtime logs continue to flow
to stdout/stderr for Railway's platform logs.
