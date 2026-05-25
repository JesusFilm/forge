# apps/manager — Agent Guide

## Role

This app orchestrates AI video enrichment pipelines. Agents working here should understand the full enrichment lifecycle: ingest (Mux) -> transcribe -> translate -> chapters -> metadata -> source artifacts -> sync/hand off. Transcript embedding generation belongs to Mastra; Manager only supplies transcript source data and may still run scene embedding helpers until that later migration lands.

## Key files

- `src/config/env.ts` — validated env schema; update here first when adding new variables
- `src/cms/gateway.ts` — live/mock/admin data boundary; new Manager-facing read-model access should go through here first
- `src/backend/admin-client.ts` — Admin GraphQL adapter for Manager read models and job state in admin backend mode
- `src/cms/mock-store.ts` + `src/cms/mock-seed.ts` — demo-only single-process mock CMS state and seeded artifacts
- `src/workflows/videoEnrichment.ts` — main pipeline; add new steps here
- `src/services/` — one file per external service
- `src/services/openrouter.ts` — shared OpenRouter client plus strict structured-output helper for JSON-shaped LLM requests
- `src/cms/client.ts` — Apollo Client for CMS (same pattern as apps/web); use typed ops from `@forge/graphql`
- `src/lib/auth.ts` — Auth-backed Manager session plus API bearer authentication
- `src/lib/state.ts` — job state facade; mock mode is local, live mode is CMS, admin mode is Admin GraphQL

## Cross-package impact

- If this app needs new CMS data: add content type in `apps/cms`, run codegen in `packages/graphql`, then use typed op here.
- If this app needs Admin-owned Manager data: add the GraphQL contract in `apps/admin`, regenerate `apps/admin/schema.graphql` and `packages/admin-graphql`, then adapt `src/backend/admin-client.ts`.
- If enrichment results should be stored in Strapi: define a mutation in `packages/graphql`.
- Mock/demo-only Manager behavior belongs inside `apps/manager`; do not add CMS schema changes or fake Strapi APIs just to support mock mode.

## UI styling

- Reuse existing app colors for manager UI work. Do not introduce new hex values, palette tokens, or one-off color variants unless the user explicitly approves a new color.

## Workflow steps checklist (when adding a new enrichment step)

1. Add service client in `src/services/`
2. Add step function, keep it idempotent
3. Wire into `src/workflows/videoEnrichment.ts`
4. Add env vars to `src/config/env.ts` and Railway service settings
5. Update `CLAUDE.md` env var table
6. If a service shells out to `ffmpeg`, make the runtime requirement explicit in docs, provision it in `nixpacks.toml` for manager deploys, and fail with a concrete error when the binary is missing
