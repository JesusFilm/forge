---
title: "Adding VideoForge as apps/manager — AI video enrichment pipeline"
category: platform
date: 2026-03-17
tags:
  - next-js
  - monorepo
  - mux
  - openrouter
  - railway-s3
  - strapi-auth
  - workflow-sdk
  - code-review
---

# Adding VideoForge as apps/manager

## Problem

JFP needed an AI video enrichment platform (transcription, translation, chapters, metadata, embeddings) integrated as a first-class monorepo app. The source project ([VideoForge](https://github.com/lumberman/videoforge)) needed adaptation to Forge monorepo conventions: Railway S3 (not AWS/R2), Doppler env vars, `@forge/graphql` for CMS, and the `workflow` SDK for durable execution.

## Solution

Ported VideoForge as `apps/manager` (`@forge/manager`) — a Next.js App Router app with:

- **8 service modules** (transcription, translation, voiceover, chapters, metadata, embeddings, mux, storage)
- **Durable workflow orchestration** via the `workflow` package (`"use workflow"` / `"use step"` directives)
- **Strapi JWT auth** — Users & Permissions plugin with a "Manager" role, HTTP-only cookie, Next.js middleware
- **Railway S3** for artifact storage (`@aws-sdk/client-s3` with `forcePathStyle: true`)
- **Apollo Client** + `@forge/graphql` for typed CMS operations
- **Shared OpenRouter client** with timeout/retry for all AI services

### Key Architecture Decisions

1. **Auth via Strapi Users & Permissions** (not static API key): Login page → POST to Strapi `/api/auth/local` → JWT in HTTP-only cookie → middleware protects `/dashboard`. API routes accept both JWT cookie (dashboard) and Bearer token (external clients).

2. **Shared OpenRouter client** (`src/services/openrouter.ts`): Single `OpenAI` instance with `timeout: 120_000` and `maxRetries: 3`, imported by all 5 AI services. Eliminates 6 duplicate instantiations.

3. **Zod validation at all boundaries**: Request bodies, JSON-shaped LLM output (via shared `createStructuredOpenrouterOutput(...)` in `src/services/openrouter.ts`), env vars (via `@t3-oss/env-nextjs`).

4. **Shared launcher + `start()` for workflow dispatch**: manager routes now dispatch through `src/workflows/launchVideoEnrichment.ts`, which calls `start(runVideoEnrichment, [input])` from `workflow/api`. The workflow runtime owns execution durability; the route keeps ownership of validation, job creation, and the immediate 201/202 response.

5. **Workflow-safe import boundaries matter once durability is real**: enabling `withWorkflow(...)` in `next.config.ts` makes `"use workflow"` / `"use step"` real, but it also means the build rejects Node-only imports pulled into the workflow body. Manager's workflow-safe pattern is: keep orchestration/state updates in the workflow, and move Mux/audio cleanup/storage/embedding-sync/scene-analysis work behind explicit `"use step"` helpers.

6. **Mux transcription only** (no OpenRouter fallback): OpenRouter doesn't expose Whisper. The original fallback asked an LLM to "generate a transcript" with no audio — producing hallucinated text. Replaced with actual VTT parsing from Mux subtitle tracks.

### Code Review Findings (14 issues found, 13 fixed)

The multi-agent review (`/ce:review`) caught critical issues before deployment:

| Category | P1 (Critical) | P2 (Important) | P3 (Nice-to-have) |
| -------- | ------------- | -------------- | ----------------- |
| Found    | 6             | 6              | 2                 |
| Fixed    | 6             | 6              | 1                 |

**Top findings:**

- No API authentication (P1) → Added Strapi JWT + API key auth
- SSRF via unvalidated `inputUrl` (P1) → Zod schema, HTTPS-only
- File state race conditions (P1) → Promise mutex + atomic writes
- Fire-and-forget workflow (P1) → shared `start()` dispatch via `workflow/api`
- Missing `output: "standalone"` (P1) → Added to next.config.ts
- Transcription returning empty/hallucinated data (P2) → Rewrote with VTT parsing

## Key Gotchas

1. **`workflow` npm package** powers the manager workflow runtime. Uses `"use workflow"` and `"use step"` string directive literals.

2. **Railway S3 requires `forcePathStyle: true`** in the S3Client config. Same pattern as `apps/cms` upload provider. Use `RAILWAY_S3_*` env vars.

3. **OpenRouter does not expose Whisper** — don't try to build a transcription fallback with chat completions. Use Mux's built-in `generated_subtitles` on asset creation.

4. **Strapi Users & Permissions JWTs don't expire by default.** Configure `plugins.js` → `users-permissions.config.jwt.expiresIn` if needed.

5. **`withWorkflow(...)` is required** for durable execution. Without the build plugin, `"use workflow"` / `"use step"` are just inert string directives.

6. **Dispatch via `start()` from `workflow/api`** — not by calling the workflow function directly. Body-only tests won't catch this; dispatch-site tests are required.

7. **No root config changes needed** for new apps — `apps/*` workspace glob covers it automatically.

## Prevention

- Always validate external data (request bodies, LLM output, file-based state) with Zod — it's already a dependency via `@t3-oss/env-nextjs`.
- Use a shared client module for any SDK instantiated in multiple services (OpenAI, Mux, S3).
- Run `/ce:review` before `/ce:compound` to catch issues while context is fresh.
- For workflow-backed background work in Next.js route handlers, dispatch through `start()` from `workflow/api` and keep Node-only service imports inside `"use step"` functions.
- When adding a new app, follow `docs/solutions/platform/adding-new-apps.md`.

## Cross-References

- [Adding new apps checklist](./adding-new-apps.md)
- [Plan](../../plans/2026-03-17-001-feat-videoforge-manager-full-port-plan.md)
- Memory: `feedback_no_aws_storage.md`, `feedback_doppler_env_vars.md`, `reference_workflow_sdk.md`
