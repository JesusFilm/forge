# apps/mastra Agent Guide

Full context lives in `apps/mastra/CLAUDE.md`. Keep both files aligned.

## Core model

- Runs the self-hosted Mastra Server runtime for Forge agents and workflows.
- Owns transcript embedding chunk planning and provider calls, then submits
  transcript vectors to Admin ingest.
- Owns scene embedding provider calls and workflow diagnostics, then submits
  scene vectors to Admin's scene-specific ingest endpoint.
- Builds Studio assets with `mastra build --studio` and serves them from the
  same internal Railway service.
- Human Studio access is handled by `apps/mastra-gateway`; this service should
  not become the human identity authority.
- App-to-runtime calls use service bearer authentication.

## Boundaries

- Do not import from app contexts such as `apps/admin`, `apps/manager`, or
  `apps/auth`.
- Do not log bearer tokens, model provider keys, cookies, or raw prompts that
  may contain sensitive data.
- Runtime storage uses Postgres via `DATABASE_URL`; Studio-visible logs and
  observability use DuckDB files under `MASTRA_STORAGE_DIR` on the Railway
  volume.
- Do not import from Admin or Manager to share types; use service HTTP
  contracts and local schemas.

## Validation

- `pnpm --filter @forge/mastra test`
- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/mastra lint`
