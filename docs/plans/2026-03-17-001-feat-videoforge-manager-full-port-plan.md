---
title: "feat: Add VideoForge as apps/manager — full AI video enrichment pipeline"
type: feat
status: completed
date: 2026-03-17
---

# feat: Add VideoForge as apps/manager — full AI video enrichment pipeline

## Overview

Port the [VideoForge](https://github.com/lumberman/videoforge) AI video enrichment platform into the Forge monorepo as `apps/manager` (`@forge/manager`). VideoForge processes video assets through structured pipelines to generate transcripts, translations, voiceovers, chapters, metadata, and semantic embeddings — all orchestrated through a Next.js dashboard with API routes for job management.

## Problem Statement / Motivation

JFP has video content that needs AI-powered enrichment (transcription, translation, chaptering, etc.) to make it searchable, accessible, and multilingual. VideoForge provides a proven architecture for this workflow. Integrating it as a first-class monorepo app lets it share the existing Strapi CMS, `@forge/graphql` typed client, and Railway/Cloudflare deployment infrastructure.

## Proposed Solution

Full port of VideoForge into `apps/manager`, adapted to Forge monorepo conventions:

- Next.js App Router dashboard with job management UI
- API routes for job CRUD (`/api/jobs`)
- 8 service modules (transcription, translation, voiceover, chapters, metadata, embeddings, mux, storage)
- `@mux/ai` integration for core enrichment workflows
- Local dev state via `.data/jobs.json`, production via durable queues
- Railway S3-compatible Object Storage for artifacts (`@aws-sdk/client-s3`, same pattern as `apps/cms`)
- Doppler for environment variable management
- Strapi CMS integration via `@forge/graphql`

## Technical Considerations

### Architecture

```
apps/manager (Next.js App Router)
├── Dashboard UI (/dashboard, /dashboard/jobs, /dashboard/jobs/[id], /dashboard/coverage)
├── API Routes (POST/GET /api/jobs, GET /api/jobs/:id)
├── Workflow Orchestration (videoEnrichment.ts)
├── Services (8 modules: transcription, translation, voiceover, chapters, metadata, embeddings, mux, storage)
├── CMS Client (@forge/graphql → apps/cms Strapi)
└── Config (t3-oss/env-nextjs validated env vars)
```

### Dependencies

| Package              | Purpose                   | Notes                                        |
| -------------------- | ------------------------- | -------------------------------------------- |
| `@mux/mux-node`      | Mux video API client      | Already in scaffold                          |
| `@mux/ai`            | AI workflows + primitives | **New** — core enrichment engine             |
| `openai`             | OpenRouter gateway client | Already in scaffold (baseURL override)       |
| `@aws-sdk/client-s3` | Railway S3 Object Storage | **New** — same as `apps/cms` upload provider |
| `@forge/graphql`     | Typed CMS operations      | Already in scaffold                          |
| `@t3-oss/env-nextjs` | Env validation            | Already in scaffold                          |

### Environment Variables

| Variable                       | Description                       | Status    |
| ------------------------------ | --------------------------------- | --------- |
| `MUX_TOKEN_ID`                 | Mux API token ID                  | In env.ts |
| `MUX_TOKEN_SECRET`             | Mux API token secret              | In env.ts |
| `OPENROUTER_API_KEY`           | OpenRouter API key                | In env.ts |
| `RAILWAY_S3_ENDPOINT`          | Railway Object Storage endpoint   | **Add**   |
| `RAILWAY_S3_REGION`            | Railway S3 region (default: auto) | **Add**   |
| `RAILWAY_S3_BUCKET`            | Railway S3 bucket name            | **Add**   |
| `RAILWAY_S3_ACCESS_KEY_ID`     | Railway S3 access key             | **Add**   |
| `RAILWAY_S3_SECRET_ACCESS_KEY` | Railway S3 secret key             | **Add**   |
| `STRAPI_URL`                   | CMS GraphQL endpoint              | In env.ts |
| `STRAPI_API_TOKEN`             | CMS API token                     | In env.ts |
| `NEXT_PUBLIC_WATCH_URL`        | Public video watch URL            | **Add**   |

All env vars managed via **Doppler** (project: `forge-manager`). Local dev: `pnpm fetch-secrets` pulls `.env` from Doppler.

### Performance

- Workflow steps are idempotent — safe to retry on failure
- Artifact storage is write-once (keyed by `{assetId}/{type}.{ext}`)
- Dashboard pages should use RSC for initial load, client components for real-time job status
- Consider ISR for coverage/analytics pages

### Security

- All env vars validated at startup (no silent failures)
- Env vars managed exclusively via Doppler — never hardcoded or committed
- Artifact storage on Railway S3 Object Storage (same infra as CMS uploads)
- API routes should validate request origin (Cloudflare WAF in production)
- Mux webhook signatures should be verified

## Implementation Phases

### Phase 1: Foundation (scaffold + core infra)

**Files to create/modify:**

- [x] `apps/manager/eslint.config.mjs` — follow `apps/web` pattern (spread commonConfig + nextVitals)
- [x] `apps/manager/src/config/env.ts` — add `RAILWAY_S3_*` vars, `NEXT_PUBLIC_WATCH_URL`
- [x] `apps/manager/package.json` — add `@mux/ai`, `@aws-sdk/client-s3` dependencies
- [x] `apps/manager/src/lib/state.ts` — local job state manager (`.data/jobs.json` in dev, durable in prod)
- [x] `apps/manager/src/services/storage.ts` — rewrite with `@aws-sdk/client-s3` for Railway S3
- [x] `apps/manager/.env.example` — document all required env vars (Doppler-managed)

**Acceptance criteria:**

- [x] `pnpm --filter @forge/manager typecheck` passes
- [x] `pnpm --filter @forge/manager lint` passes
- [x] Storage reads/writes artifacts to Railway S3 Object Storage
- [x] Local state read/write works with `.data/jobs.json`
- [x] `pnpm fetch-secrets` pulls env from Doppler (project: `forge-manager`)

### Phase 2: Services (enrichment pipeline)

**Files to create:**

- [x] `apps/manager/src/services/transcription.ts` — rewrite with Mux subtitles + OpenRouter fallback
- [x] `apps/manager/src/services/translation.ts` — multi-language translation via OpenRouter
- [x] `apps/manager/src/services/voiceover.ts` — AI voice synthesis via OpenRouter TTS
- [x] `apps/manager/src/services/chapters.ts` — automatic chapter segmentation
- [x] `apps/manager/src/services/metadata.ts` — topic/speaker/theme extraction
- [x] `apps/manager/src/services/embeddings.ts` — vector embeddings for semantic search
- [x] `apps/manager/src/services/mux.ts` — enhanced with asset info, playback URLs, thumbnails

**Artifact output types:**

| Service       | Artifact    | Format  |
| ------------- | ----------- | ------- |
| transcription | transcript  | `.json` |
| transcription | subtitles   | `.vtt`  |
| translation   | translation | `.json` |
| voiceover     | audio       | `.mp3`  |
| chapters      | chapters    | `.json` |
| metadata      | metadata    | `.json` |
| embeddings    | embeddings  | `.json` |

**Acceptance criteria:**

- [ ] Each service is independently testable
- [ ] Each service writes artifacts to Railway S3 with correct key format
- [ ] All services are idempotent (safe to retry)

### Phase 3: Workflow orchestration

**Files to create/modify:**

- [x] `apps/manager/src/workflows/videoEnrichment.ts` — rewrite as full pipeline:
  1. Job creation with Mux asset ID
  2. Asset preprocessing via `@mux/ai/primitives`
  3. Core enrichment via `@mux/ai/workflows`
  4. Artifact persistence to Railway S3 Object Storage
  5. Optional Mux re-upload and CMS sync
  6. Dashboard state update

**Acceptance criteria:**

- [ ] Pipeline runs end-to-end with a test Mux asset
- [ ] Each step updates job state (pending → processing → complete/failed)
- [ ] Errors produce diagnostic failure codes, not crashes

### Phase 4: API routes + Dashboard UI

**API routes to create:**

- [x] `apps/manager/src/app/api/jobs/route.ts` — `POST` (create job), `GET` (list jobs)
- [x] `apps/manager/src/app/api/jobs/[id]/route.ts` — `GET` (job details + status)

**Dashboard pages to create:**

- [x] `apps/manager/src/app/dashboard/page.tsx` — overview with job stats
- [x] `apps/manager/src/app/dashboard/jobs/page.tsx` — job listing with status filters
- [x] `apps/manager/src/app/dashboard/jobs/[id]/page.tsx` — individual job detail (progress, artifacts, logs)
- [x] `apps/manager/src/app/dashboard/coverage/page.tsx` — media coverage inspection
- [x] `apps/manager/src/app/dashboard/layout.tsx` — dashboard shell with navigation

**Acceptance criteria:**

- [ ] Dashboard renders job list from local state
- [ ] Job creation form triggers API route → workflow
- [ ] Job detail page shows real-time status and artifact links
- [ ] All pages export metadata

### Phase 5: CMS integration + deployment

- [ ] Define video enrichment content types in Strapi (if needed for editorial workflow)
- [ ] Run codegen in `packages/graphql` for any new types
- [ ] Add typed operations for CMS sync (mutations to store enrichment results)
- [x] Configure Railway service `forge-manager` with Doppler integration
- [x] Provision Railway S3 Object Storage bucket for artifacts (`@forge/manager/artifacts`, sjc region)
- [ ] Verify Cloudflare routing to Railway service
- [ ] Add health check endpoint

**Acceptance criteria:**

- [ ] Enrichment results sync back to Strapi
- [ ] `@forge/graphql` typed operations work for read/write
- [ ] Railway deployment succeeds with health check passing

## Existing Scaffold State

The earlier conversation already created:

| File                                            | Status                                                   |
| ----------------------------------------------- | -------------------------------------------------------- |
| `apps/manager/package.json`                     | Done — needs `@mux/ai` added; `@aws-sdk/client-s3` added |
| `apps/manager/tsconfig.json`                    | Done                                                     |
| `apps/manager/next.config.ts`                   | Done                                                     |
| `apps/manager/railway.toml`                     | Done                                                     |
| `apps/manager/CLAUDE.md`                        | Done                                                     |
| `apps/manager/AGENTS.md`                        | Done                                                     |
| `apps/manager/src/config/env.ts`                | Done — needs `NEXT_PUBLIC_WATCH_URL`                     |
| `apps/manager/src/app/layout.tsx`               | Done — needs dashboard layout                            |
| `apps/manager/src/app/page.tsx`                 | Done — placeholder, redirect to /dashboard               |
| `apps/manager/src/cms/strapiClient.ts`          | Done                                                     |
| `apps/manager/src/services/mux.ts`              | Stub — needs enhancement                                 |
| `apps/manager/src/services/transcription.ts`    | Stub — needs rewrite                                     |
| `apps/manager/src/services/storage.ts`          | Done — uses `@aws-sdk/client-s3` with Railway S3         |
| `apps/manager/src/workflows/videoEnrichment.ts` | Stub — needs full pipeline                               |
| `apps/manager/eslint.config.mjs`                | **Missing**                                              |

## Dependencies & Risks

| Risk                                       | Mitigation                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@mux/ai` package may not be public on npm | Check npm registry; fall back to direct Mux API + OpenRouter                                       |
| `workflow` package API                     | SDK is `workflow` (from https://useworkflow.dev/); uses `"use workflow"` / `"use step"` directives |
| Railway S3 bucket provisioning             | Provision in Railway dashboard; share `RAILWAY_S3_*` creds via Doppler                             |
| Strapi schema changes needed               | Follow GraphQL Change Flow (codegen in same PR)                                                    |

## Success Metrics

- End-to-end enrichment of a single video asset works locally
- Dashboard shows job progress in real-time
- All 7 artifact types generated and stored in Railway S3
- Transcription available in at least 2 languages
- TypeScript strict mode passes with no `any` casts

## Sources & References

### Internal References

- Adding new apps: `docs/solutions/platform/adding-new-apps.md`
- Web app patterns: `apps/web/CLAUDE.md`, `apps/web/src/env.ts`
- GraphQL client: `packages/graphql/CLAUDE.md`
- ESLint pattern: `apps/web/eslint.config.mjs`

### External References

- VideoForge source: https://github.com/lumberman/videoforge
- Mux Node SDK: https://github.com/muxinc/mux-node-sdk
- OpenRouter API: https://openrouter.ai/docs
- Railway Object Storage: https://docs.railway.com/reference/object-storage
- Doppler: https://docs.doppler.com
