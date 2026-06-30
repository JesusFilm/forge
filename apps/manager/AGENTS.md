# apps/manager — Agent Guide

## Role

This app orchestrates AI video enrichment pipelines. Agents working here should understand the full enrichment lifecycle: ingest (Mux) -> transcribe -> translate -> chapters -> metadata -> source artifacts -> sync/hand off through Manager/Admin GraphQL contracts. Transcript and experience embedding generation belong to Mastra; Manager only supplies source artifacts such as transcript and scene-analysis JSON. Scene embedding sync into Admin is retired; scene analysis may remain only for non-search product workflows. Subtitle translation/retiming execution also belongs to Mastra. Source transcript scripture correction judgment belongs to Mastra, while Manager owns deterministic exact-match application, raw/canonical artifact writes, job state, optional video context handoff, validation/correction summary display, artifact manifests, and Mux subtitle sync. Do not reintroduce Manager-side vector generation, provider-heavy subtitle execution, scripture-context detection, subtitle scripture validation, Bible-source calls, or CMS-specific embedding sync.

## Key files

- `src/config/env.ts` — validated env schema; update here first when adding new variables
- `src/cms/gateway.ts` — legacy-named live/mock/admin data boundary; new Manager-facing read-model access should go through Admin contracts
- `src/backend/admin-client.ts` — Admin GraphQL adapter for Manager read models and job state in admin backend mode
- `src/cms/mock-store.ts` + `src/cms/mock-seed.ts` — demo-only single-process mock CMS state and seeded artifacts
- `src/workflows/videoEnrichment.ts` — main pipeline; add new steps here
- `src/services/` — one file per external service
- `src/services/openrouter.ts` — shared OpenRouter client plus strict structured-output helper for JSON-shaped LLM requests
- `src/cms/client.ts` — legacy live-mode Apollo bridge; do not add new operations here or new CMS dependencies
- `src/lib/auth.ts` — Auth-backed Manager session plus API bearer authentication
- `src/lib/state.ts` — job state facade; mock mode is local, live mode is CMS, admin mode is Admin GraphQL

## Cross-package impact

- If this app needs Admin-owned Manager data: add the GraphQL contract in `apps/admin`, regenerate `apps/admin/schema.graphql` and `packages/admin-graphql`, then adapt `src/backend/admin-client.ts`.
- If enrichment results need canonical storage, model the write in Admin/Manager GraphQL rather than reintroducing a CMS-specific contract.
- Mock/demo-only Manager behavior belongs inside `apps/manager`; do not add schema changes or fake remote APIs just to support mock mode.

## UI styling

- Reuse existing app colors for manager UI work. Do not introduce new hex values, palette tokens, or one-off color variants unless the user explicitly approves a new color.

## Workflow steps checklist (when adding a new enrichment step)

1. Add service client in `src/services/`
2. Add step function, keep it idempotent
3. Wire into `src/workflows/videoEnrichment.ts`
4. Add env vars to `src/config/env.ts` and Railway service settings
5. Update `CLAUDE.md` env var table
6. If a service shells out to `ffmpeg`, make the runtime requirement explicit in docs, provision it in `nixpacks.toml` for manager deploys, and fail with a concrete error when the binary is missing
