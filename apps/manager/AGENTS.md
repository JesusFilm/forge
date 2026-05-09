# apps/manager — Agent Guide

## Role

This app orchestrates AI video enrichment pipelines. Agents working here should understand the full enrichment lifecycle: ingest (Mux) -> transcribe -> translate -> chapters -> metadata -> embeddings -> store (Railway S3) -> sync (Strapi).

## Key files

- `src/config/env.ts` — validated env schema; update here first when adding new variables
- `src/cms/gateway.ts` — admin/mock/strapi backend boundary; new Manager-facing backend reads and auth should go through here first
- `src/backend/admin-client.ts` — Manager-to-Admin GraphQL transport adapter
- `src/cms/mock-store.ts` + `src/cms/mock-seed.ts` — demo-only single-process mock CMS state and seeded artifacts
- `src/workflows/videoEnrichment.ts` — main pipeline; add new steps here
- `src/services/` — one file per external service
- `src/services/openrouter.ts` — shared OpenRouter client plus strict structured-output helper for JSON-shaped LLM requests
- `src/cms/client.ts` — legacy Strapi GraphQL client; keep new Admin-backed Manager contracts in the backend gateway instead
- `src/lib/auth.ts` — API route authentication (`manager-session` + Bearer token)
- `src/lib/state.ts` — local job state (file-backed; replace with durable store in production)

## Auth boundary

- Manager login still posts to `POST /api/auth/login` and writes
  `manager-session`.
- In Admin-backed mode, the user must be a registered Admin user with an
  active Admin `ManagerMembership` and `ManagerRole.OPERATOR`.
- Admin editorial roles alone do not grant Manager panel access.
- Legacy `strapi-jwt` cookies are not accepted for Manager panel access.

## Cross-package impact

- If this app needs new CMS data: add content type in `apps/cms`, run codegen in `packages/graphql`, then use typed op here.
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
