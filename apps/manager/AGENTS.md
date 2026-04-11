# apps/manager — Agent Guide

## Role

This app orchestrates AI video enrichment pipelines. Agents working here should understand the full enrichment lifecycle: ingest (Mux) -> transcribe -> translate -> chapters -> metadata -> embeddings -> store (Railway S3) -> sync (Strapi).

## Key files

- `src/config/env.ts` — validated env schema; update here first when adding new variables
- `src/workflows/videoEnrichment.ts` — main pipeline; add new steps here
- `src/services/` — one file per external service
- `src/services/openrouter.ts` — shared OpenRouter client plus strict structured-output helper for JSON-shaped LLM requests
- `src/cms/client.ts` — Apollo Client for CMS (same pattern as apps/web); use typed ops from `@forge/graphql`
- `src/lib/auth.ts` — API route authentication (JWT cookie + Bearer token)
- `src/lib/state.ts` — local job state (file-backed; replace with durable store in production)

## Cross-package impact

- If this app needs new CMS data: add content type in `apps/cms`, run codegen in `packages/graphql`, then use typed op here.
- If enrichment results should be stored in Strapi: define a mutation in `packages/graphql`.

## UI styling

- Reuse existing app colors for manager UI work. Do not introduce new hex values, palette tokens, or one-off color variants unless the user explicitly approves a new color.

## Workflow steps checklist (when adding a new enrichment step)

1. Add service client in `src/services/`
2. Add step function, keep it idempotent
3. Wire into `src/workflows/videoEnrichment.ts`
4. Add env vars to `src/config/env.ts` and Railway service settings
5. Update `CLAUDE.md` env var table
