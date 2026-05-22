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

| Variable                  | Purpose                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Postgres connection string for Mastra runtime storage. Required in production runtime. |
| `MASTRA_SERVICE_API_KEYS` | CSV allowlist for service bearer calls. Required in production runtime.                |
| `MASTRA_STORAGE_DIR`      | Directory for Studio-visible observability/log files. Use `/data/mastra` on Railway.   |
| `OPENAI_API_KEY`          | Model provider key for smoke agent/model-routed calls when model execution is tested.  |
| `PORT`                    | Railway-provided runtime port. Mastra defaults to `4111` locally.                      |
| `MASTRA_STUDIO_PATH`      | Set to `.mastra/output/studio` when starting the built server with Studio assets.      |

## Railway Storage

Production `@forge/mastra` uses the existing Mastra Postgres database through
`DATABASE_URL` as the default runtime store. Studio-visible observability/log
data uses Mastra's supported DuckDB store under `MASTRA_STORAGE_DIR`, backed by
the Railway volume mounted at `/data`.

Keep `PinoLogger` configured as the app logger so runtime logs continue to flow
to stdout/stderr for Railway's platform logs.
