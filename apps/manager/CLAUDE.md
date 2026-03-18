# apps/manager — VideoForge Manager

## What this app does

AI video enrichment pipeline dashboard. Ingests video assets via Mux, runs enrichment workflows (transcription, translation, chapters, metadata, embeddings) using OpenRouter-routed AI models, stores artifacts in Railway S3-compatible Object Storage, and optionally syncs results back to Strapi CMS via `@forge/graphql`.

## Source

Modelled on [VideoForge](https://github.com/lumberman/videoforge) — adapted to the Forge monorepo conventions.

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- Mux (`@mux/mux-node`) for video asset management and streaming
- OpenRouter (`openai` SDK with `baseURL: https://openrouter.ai/api/v1`) for AI model access
- Railway S3-compatible Object Storage (`@aws-sdk/client-s3`) for artifacts — same pattern as `apps/cms` upload provider
- workflow (`npm i workflow` from https://useworkflow.dev/) for durable workflow orchestration — uses `"use workflow"` and `"use step"` directives
- `@forge/graphql` for typed Strapi CMS queries
- Doppler for environment variable management

## Folder structure

```
src/
  app/           Next.js App Router pages and API routes
  config/env.ts  Validated env vars (t3-oss/env-nextjs + zod)
  workflows/     Durable workflow definitions (useworkflow.dev)
  services/      Service clients: mux, transcription, storage
  cms/           Strapi GraphQL client (wraps @forge/graphql)
```

## Conventions

- All env vars validated at startup via `src/config/env.ts`. Never read `process.env` directly.
- Env vars managed by **Doppler** (project: `forge-manager`). Use `pnpm fetch-secrets` for local dev.
- CMS access goes through `src/cms/client.ts` (Apollo Client) with `@forge/graphql` typed operations. Never use Strapi REST.
- Workflow steps must be idempotent — they may be retried by useworkflow.dev.
- Artifact storage uses Railway S3 with `@aws-sdk/client-s3`. Keys: `{assetId}/{artifact-type}.{ext}`.
- Storage uses the same `RAILWAY_S3_*` env var pattern as `apps/cms`.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-manager)
pnpm dev              # http://localhost:3002
pnpm build && pnpm start
pnpm lint / pnpm typecheck
```

## Authentication

Dashboard access requires Strapi Users & Permissions login with the "Manager" role.
Flow: Login page → POST /api/auth/login → Strapi /api/auth/local → JWT cookie → middleware protects /dashboard.
API routes also accept Bearer token (MANAGER_API_KEY) for external clients.

Local dev requires a Strapi user with role name exactly `Manager`. Create via Strapi admin at `http://localhost:1337/admin` > Settings > Users & Permissions > Roles.

## Common pitfalls

- The workflow SDK package is `workflow` (not `@workflowdev/sdk`). See https://useworkflow.dev/.
- OpenRouter does not expose a Whisper transcription endpoint — use a supported model or switch to Mux's built-in transcription (`input[].generated_subtitles`).
- Railway S3 requires `forcePathStyle: true` in the S3Client config.
- Job state (`.data/jobs.json`) is file-based and ephemeral on Railway. Data is lost on deploy/restart. Must be replaced with a durable store (Strapi content type or database) before production use.
- The `"use workflow"` and `"use step"` directives in `src/workflows/` are **inert** without the workflow SDK's build plugin configured in `next.config.ts`. Until the plugin is added and `WORKFLOW_API_KEY` is set, workflows run as plain async functions with no durability, retries, or checkpointing. See https://useworkflow.dev/.

## Environment variables (Doppler project: forge-manager)

| Variable                     | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| MUX_TOKEN_ID                 | Mux API token ID                                       |
| MUX_TOKEN_SECRET             | Mux API token secret                                   |
| OPENROUTER_API_KEY           | OpenRouter API key                                     |
| RAILWAY_S3_ENDPOINT          | Railway Object Storage endpoint                        |
| RAILWAY_S3_REGION            | Railway S3 region (default: auto)                      |
| RAILWAY_S3_BUCKET            | Railway S3 bucket name                                 |
| RAILWAY_S3_ACCESS_KEY_ID     | Railway S3 access key                                  |
| RAILWAY_S3_SECRET_ACCESS_KEY | Railway S3 secret key                                  |
| STRAPI_URL                   | URL of apps/cms (Railway internal)                     |
| STRAPI_API_TOKEN             | Strapi API token (seeded in bootstrap)                 |
| WORKFLOW_API_KEY             | workflow API key (optional, for production durability) |
| MANAGER_API_KEY              | API key for external clients (optional in dev)         |
| NEXT_PUBLIC_WATCH_URL        | Public video watch URL (optional)                      |
