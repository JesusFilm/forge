# apps/manager — VideoForge Manager

## What this app does

AI video enrichment pipeline dashboard. Ingests video assets via Mux, runs enrichment workflows (transcription, translation, chapters, metadata, embeddings) using OpenRouter-routed AI models, stores artifacts in Railway S3-compatible Object Storage, and optionally syncs results back to Strapi CMS via `@forge/graphql`.

## Source

Modelled on [VideoForge](https://github.com/lumberman/videoforge) — adapted to the Forge monorepo conventions.

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- Mux (`@mux/mux-node`) for video asset management and streaming
- OpenRouter (`openai` SDK with `baseURL: https://openrouter.ai/api/v1`) for AI model access
- ElevenLabs audio isolation (`fetch` + multipart form upload) for manager-only audio cleanup review artifacts
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
- Storage uses the same `RAILWAY_S3_*` env var pattern as `apps/cms`. When `RAILWAY_S3_BUCKET` is not set, artifacts fall back to local `.tmp/artifacts/` — suitable for dev and test environments.
- JSON-shaped LLM outputs should go through `createStructuredOpenrouterOutput(...)` in `src/services/openrouter.ts` with a Zod schema plus strict JSON Schema; use raw chat completions only for plain-text tasks.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-manager)
pnpm dev              # http://localhost:3002
pnpm build && pnpm start
pnpm lint / pnpm typecheck
```

## Authentication

Dashboard access requires a user with the "Manager" role.

- `MANAGER_DATA_MODE=live`: Login page → `POST /api/auth/login` → Strapi `/api/auth/local` → `strapi-jwt` cookie → middleware protects `/dashboard`.
- `MANAGER_DATA_MODE=mock`: Login page → `POST /api/auth/login` → Manager mock gateway/session signer → `strapi-jwt` cookie → middleware protects `/dashboard`.

API routes also accept Bearer token (`MANAGER_API_KEY`) for external clients.

Local live-mode dev requires a Strapi user with role name exactly `Manager`. Create via Strapi admin at `http://localhost:1337/admin` > Settings > Users & Permissions > Roles.

Local mock-mode smoke tests can use the seeded credentials:

- email: `manager@forge.test`
- password: `mock-manager-password`

## Triggering admin embedding backfills (plan 006)

Manager exposes two REST endpoints that proxy to apps/admin's
`triggerSceneEmbeddingBackfill` /
`triggerTranscriptEmbeddingBackfill` GraphQL mutations:

- `POST /api/admin-embeds/scene` — body `{ mappingS3Key?, coreIds?,
locales? }`
- `POST /api/admin-embeds/transcript` — body `{ mappingS3Key?,
coreIds?, languages? }`

Admin owns the destination Postgres schema (`video_scene_locale`,
`video_transcript`, `video_transcript_chunk`); manager only carries
the trigger surface. Proxy ensures behaviour parity by definition —
single workflow, single source of truth.

**Auth (manager-side):** `authenticateRequest` — same Strapi JWT
cookie or `MANAGER_API_KEY` bearer used by every other manager API
route.

**Auth (manager → admin):** `Authorization: Bearer
${ADMIN_EMBED_TRIGGER_API_KEY}` against admin's GraphQL endpoint.
Admin validates via its `WORKFLOW_API_KEYS` allowlist and mints a
request-bound `WORKFLOW_TRIGGER` principal that satisfies only
`write:scene-embeddings` + `write:transcript-embeddings`.

**Env on `forge-manager` Doppler:**

- `ADMIN_GRAPHQL_URL` — full URL of admin's `/api/graphql` (e.g.
  `https://admin.jesusfilm.org/api/graphql`).
- `ADMIN_EMBED_TRIGGER_API_KEY` — must match an entry in admin's
  `WORKFLOW_API_KEYS` CSV. Rotation is a Doppler change on both apps
  simultaneously.

The proxy helper lives at `src/lib/admin-embed-trigger.ts`. The
shared route handler is `src/lib/admin-embed-route.ts`. The
admin-side runbook (`apps/admin/CLAUDE.md` "Running embeds locally"

- "Triggering embeds from manager" sections) carries the
  authoritative architectural reference.

**Response envelope:**

| HTTP | Body shape                                                        | When                                            |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------- |
| 200  | `{ result: <admin mutation response> }`                           | success                                         |
| 400  | `{ error, details? }`                                             | manager-side body parse / Zod validation failed |
| 401  | (manager auth response)                                           | no JWT cookie / invalid `MANAGER_API_KEY`       |
| 502  | `{ error, reason, messages: string[], retryable: boolean }`       | admin GraphQL / network / parse error           |
| 503  | `{ error, reason: "config_missing", messages, retryable: false }` | manager env not configured to proxy             |

`reason` ∈ `"graphql_error" | "network_error" | "parse_error" | "config_missing"`.
`retryable` is `true` for transient transport errors (network/parse — typically
upstream hiccup), `false` for upstream rejections (graphql_error) or operator
misconfig (config_missing). A 502 with `retryable: true` is a safe candidate
for a single bounded retry; the underlying admin workflow upserts on
composite keys, so retries are idempotent.

## Common pitfalls

- The workflow SDK package is `workflow` (not `@workflowdev/sdk`). See https://useworkflow.dev/.
- OpenRouter does not expose a Whisper transcription endpoint — use a supported model or switch to Mux's built-in transcription (`input[].generated_subtitles`).
- Railway S3 requires `forcePathStyle: true` in the S3Client config.
- Audio cleanup extracts original audio with `ffmpeg` before calling ElevenLabs. The manager Railway service uses the repo-root `nixpacks.toml` to add `ffmpeg` to the NIXPACKS setup phase; the helper still throws a clear error if the binary is missing.
- Job state is stored in Strapi as `EnrichmentJob` content type (with `enrichment.job-step` repeatable component). The `src/lib/state.ts` module provides the same `createJob`/`getJob`/`listJobs`/`updateJob`/`updateStepStatus` API backed by Strapi GraphQL mutations.
- Manager now enables the workflow SDK build plugin in `next.config.ts`, and enrichment entrypoints dispatch through `src/workflows/launchVideoEnrichment.ts` via `start()` from `workflow/api`. The workflow runtime is no longer inert.
- Workflow-safe authoring still matters: keep Node-only imports and heavy service modules behind `"use step"` boundaries. A built app will reject workflow files that pull Node-only modules into the top-level workflow body. See https://useworkflow.dev/.

## Environment variables (Doppler project: forge-manager)

| Variable                     | Description                                                               |
| ---------------------------- | ------------------------------------------------------------------------- |
| MUX_TOKEN_ID                 | Mux API token ID                                                          |
| MUX_TOKEN_SECRET             | Mux API token secret                                                      |
| OPENROUTER_API_KEY           | OpenRouter API key                                                        |
| ELEVENLABS_API_KEY           | ElevenLabs API key for audio isolation (optional — enables audio cleanup) |
| RAILWAY_S3_ENDPOINT          | Railway Object Storage endpoint (optional — local fallback)               |
| RAILWAY_S3_REGION            | Railway S3 region (default: auto)                                         |
| RAILWAY_S3_BUCKET            | Railway S3 bucket name (optional — triggers S3 mode)                      |
| RAILWAY_S3_ACCESS_KEY_ID     | Railway S3 access key (optional)                                          |
| RAILWAY_S3_SECRET_ACCESS_KEY | Railway S3 secret key (optional)                                          |
| MANAGER_DATA_MODE            | `live` or `mock` (default `live`)                                         |
| MANAGER_MOCK_SESSION_SECRET  | Required in `mock` mode to sign Manager-issued mock sessions              |
| MANAGER_MOCK_DATA_PATH       | Optional mock runtime store path (default `.tmp/mock-cms/store.json`)     |
| STRAPI_URL                   | URL of apps/cms (required in `live`, ignored in `mock`)                   |
| STRAPI_API_TOKEN             | Strapi API token (required in `live`, ignored in `mock`)                  |
| STRAPI_INTERNAL_API_TOKEN    | Optional internal CMS token for live-only writer paths                    |
| WORKFLOW_API_KEY             | workflow API key (optional, for production durability)                    |
| MANAGER_API_KEY              | API key for external clients (optional in dev)                            |
| ADMIN_GRAPHQL_URL            | Full URL of admin's `/api/graphql` (used by `/api/admin-embeds/*`)        |
| ADMIN_EMBED_TRIGGER_API_KEY  | Bearer key, must match an entry in admin's `WORKFLOW_API_KEYS`            |
| NEXT_PUBLIC_WATCH_URL        | Public video watch URL (optional)                                         |

## Standalone smoke

The Railway standalone build copies `apps/manager/.next/static` into `apps/manager/.next/standalone/apps/manager/.next/static` before starting `server.js`. Follow that same shape for local standalone smoke tests; without the copied static assets the login page HTML renders but the client JS does not hydrate.
