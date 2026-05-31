# apps/manager — VideoForge Manager

## What this app does

AI video enrichment pipeline dashboard. Ingests video assets via Mux, runs enrichment workflows (transcription, translation, chapters, metadata, and source-artifact generation), stores artifacts in Railway S3-compatible Object Storage, and syncs results through Manager/Admin GraphQL contracts. Background transcript, scene, and experience embedding generation belongs to Mastra; Manager only supplies source artifacts.

## Source

Modelled on [VideoForge](https://github.com/lumberman/videoforge) — adapted to the Forge monorepo conventions.

## Stack

- Next.js 16+ App Router with TypeScript strict mode
- Mux (`@mux/mux-node`) for video asset management and streaming
- OpenRouter (`openai` SDK with `baseURL: https://openrouter.ai/api/v1`) for AI model access
- ElevenLabs audio isolation (`fetch` + multipart form upload) for manager-only audio cleanup review artifacts
- Railway S3-compatible Object Storage (`@aws-sdk/client-s3`) for artifacts
- workflow (`npm i workflow` from https://useworkflow.dev/) for durable workflow orchestration — uses `"use workflow"` and `"use step"` directives
- `@forge/admin-graphql` for typed Admin GraphQL contracts
- Doppler for environment variable management

## Folder structure

```
src/
  app/           Next.js App Router pages and API routes
  config/env.ts  Validated env vars (t3-oss/env-nextjs + zod)
  workflows/     Durable workflow definitions (useworkflow.dev)
  services/      Service clients: mux, transcription, storage
  cms/           legacy-named live/mock/admin data gateway and bridge code
```

## Conventions

- All env vars validated at startup via `src/config/env.ts`. Never read `process.env` directly.
- Env vars managed by **Doppler** (project: `forge-manager`). Use `pnpm fetch-secrets` for local dev.
- New canonical data access goes through Admin GraphQL contracts. Keep legacy `src/cms/*` code isolated behind `src/cms/gateway.ts` while the Manager backend migration finishes; do not add new CMS dependencies or CMS-specific embedding sync.
- Workflow steps must be idempotent — they may be retried by useworkflow.dev.
- Artifact storage uses Railway S3 with `@aws-sdk/client-s3`. Keys: `{assetId}/{artifact-type}.{ext}`.
- Storage uses the `RAILWAY_S3_*` env var pattern. When `RAILWAY_S3_BUCKET` is not set, artifacts fall back to local `.tmp/artifacts/` — suitable for dev and test environments.
- JSON-shaped LLM outputs should go through `createStructuredOpenrouterOutput(...)` in `src/services/openrouter.ts` with a Zod schema plus strict JSON Schema; use raw chat completions only for plain-text tasks.

## Development

```bash
pnpm fetch-secrets    # Pull .env from Doppler (forge-manager)
pnpm dev              # http://localhost:3002
pnpm build && pnpm start
pnpm lint / pnpm typecheck
```

## Authentication

Dashboard access uses the shared Auth issuer and an explicit Admin
`ManagerMembership` grant.

- Login page redirects to Auth (`AUTH_ISSUER_URL`) with the Manager
  client (`AUTH_MANAGER_CLIENT_ID`).
- `/api/auth/callback` exchanges the OAuth code, calls Admin's
  Manager session validation endpoint, and issues a local
  `manager-session` cookie only for `ManagerRole.OPERATOR` users.
- Middleware protects `/dashboard` with that local session. A legacy
  `strapi-jwt` cookie is not sufficient for dashboard access.
- `MANAGER_DATA_MODE=mock` is demo/test only and signs local mock
  sessions with `MANAGER_MOCK_SESSION_SECRET`.

API routes also accept Bearer token (`MANAGER_API_KEY`) for external clients.

Admin-owned read models and job state can be enabled independently with
`MANAGER_BACKEND_MODE=admin` (or `MANAGER_DATA_MODE=admin`). In that mode
Manager reads/writes the Admin GraphQL Manager contracts using
`ADMIN_GRAPHQL_URL`. Session validation should use the Auth-issued
`AUTH_MANAGER_SERVICE_CLIENT_ID` / `AUTH_MANAGER_SERVICE_CLIENT_SECRET`
service credential when configured, falling back to `ADMIN_MANAGER_API_KEY`
during the dual-accept migration. These service credentials are separate from
human Manager panel access.

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

## Receiving admin-trigger requests (feat-119 PR2)

Inverse direction of "Triggering admin embedding backfills" above.
Admin's new `triggerManagerEnrichment` GraphQL mutation calls
`/api/admin-trigger/{scene-analysis,transcript}` to ask manager to
PRODUCE a missing upstream artifact (typically after an operator
has reviewed PR1's `missingArtifacts` projection).

**Endpoints:**

- `POST /api/admin-trigger/scene-analysis` — dispatches
  `runSceneAnalysisPipeline` per item. Manager writes
  `{assetId}/scene-analysis.json` source data only; Mastra owns scene
  embedding generation and Admin owns vector storage/search.
- `POST /api/admin-trigger/transcript` — dispatches the new
  `runTranscriptOnlyPipeline` (composes existing `transcribe()` with
  the Mastra transcript embedding launcher; Manager writes
  `{assetId}/transcript.json` source data and does not produce
  `{assetId}/embeddings.json` for transcripts).

Legacy `/api/backfill/{start,status,cancel}` routes are retired and
return `410` after authentication. Scene embedding generation now runs
through Admin-triggered Mastra workflows; Manager remains source-only
for scene-analysis artifacts.

**Body shape:** `{ items: [{ assetId: number, coreId: string }, ...] }`.
Capped at 100 items per call. Manager dedupes by `assetId` at the
boundary. `coreId` is the lookup key into admin's `videosByCoreIds`
GraphQL query (feat-125 — replaced the prior Strapi `videos(filters:
{ coreId: { in: ... } })` call); `assetId` is the operator-facing
identifier and the storage-key prefix manager uses when writing
artifacts.

**Auth:** `Authorization: Bearer <key>` against the
`ADMIN_TRIGGER_API_KEYS` CSV allowlist. Mirrors admin's
`WORKFLOW_API_KEYS` shape — receiver-side CSV, caller-side single
key. Validator: `src/lib/admin-trigger-auth.ts`. Returns 503
`config_missing` when `ADMIN_TRIGGER_API_KEYS` is unset (so the
admin-side client distinguishes "manager not configured" from
"your bearer is wrong"); 401 on missing/wrong bearer.

**Per-item idempotency:** in-memory `Map<\`${kind}:${assetId}\`,
{ managerJobId, expiresAt }>`with a 5-minute TTL. Slot released
as soon as the per-item dispatch resolves. Deliberately simpler
than EnrichmentJob-backed idempotency because EnrichmentJob is
keyed by Strapi documentId, not numeric assetId, and the existing`/api/scene-analysis`route does not create EnrichmentJob rows
anyway. The realistic threat is operator double-click within
seconds, not multi-instance concurrency. See`docs/solutions/platform/admin-manager-enrichment-trigger-endpoint-20260506.md`
for the deviation rationale.

**Per-item outcome:** discriminated by `status`:

| status              | Meaning                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `started`           | New `managerJobId` minted; pipeline dispatched in background via `after()`                                                                                                                                                   |
| `already_in_flight` | Existing `managerJobId` returned (in-flight slot held by a recent call)                                                                                                                                                      |
| `not_found`         | No admin video for the supplied `coreId`                                                                                                                                                                                     |
| `validation_failed` | admin video found but missing required dispatch fields — `message` names the specific gap(s): primary language / mux variant. Subtitle URL is used when present; otherwise manager can fall back to Mux-generated subtitles. |

**Non-2xx envelope (feat-125):** when admin's `videosByCoreIds`
lookup fails, the route surfaces a typed body instead of a bare
error string:

| HTTP | Body shape                                                                                                                         | When                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 502  | `{ error, reason: "admin_unreachable", upstreamReason: "graphql_error" \| "network_error" \| "parse_error", messages, retryable }` | admin GraphQL / network / parse failure on the `videosByCoreIds` call            |
| 503  | `{ error, reason: "config_missing", upstreamReason: "config_missing", messages, retryable: false }`                                | manager env is unconfigured to call admin (`ADMIN_GRAPHQL_URL` / bearer not set) |

**Env on `forge-manager` Doppler:**

- `ADMIN_TRIGGER_API_KEYS` — CSV of bearer keys admin can use.
  Rotation: stage the new key alongside the old, deploy admin's
  `MANAGER_TRIGGER_API_KEY` to one of the entries, drop the old
  entry on the next rotation cycle.

**Deploy-ordering invariant:** receiver FIRST. Set
`ADMIN_TRIGGER_API_KEYS` on manager, accept-deploy, verify with
`curl -H "Authorization: Bearer wrong"` returning 401 (not 503),
THEN set `MANAGER_API_BASE_URL` + `MANAGER_TRIGGER_API_KEY` on
admin and accept-deploy. Reverse order produces a dead minute
where admin's first call 401s.

## Common pitfalls

- The workflow SDK package is `workflow` (not `@workflowdev/sdk`). See https://useworkflow.dev/.
- OpenRouter does not expose a Whisper transcription endpoint — use a supported model or switch to Mux's built-in transcription (`input[].generated_subtitles`).
- Railway S3 requires `forcePathStyle: true` in the S3Client config.
- Audio cleanup extracts original audio with `ffmpeg` before calling ElevenLabs. The manager Railway service uses the repo-root `nixpacks.toml` to add `ffmpeg` to the NIXPACKS setup phase; the helper still throws a clear error if the binary is missing.
- Job state is moving to Admin-owned Manager contracts. The `src/lib/state.ts` module preserves the same `createJob`/`getJob`/`listJobs`/`updateJob`/`updateStepStatus` API while routing by backend mode.
- Manager now enables the workflow SDK build plugin in `next.config.ts`, and enrichment entrypoints dispatch through `src/workflows/launchVideoEnrichment.ts` via `start()` from `workflow/api`. The workflow runtime is no longer inert.
- Workflow-safe authoring still matters: keep Node-only imports and heavy service modules behind `"use step"` boundaries. A built app will reject workflow files that pull Node-only modules into the top-level workflow body. See https://useworkflow.dev/.

## Environment variables (Doppler project: forge-manager)

| Variable                               | Description                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| MUX_TOKEN_ID                           | Mux API token ID                                                               |
| MUX_TOKEN_SECRET                       | Mux API token secret                                                           |
| OPENROUTER_API_KEY                     | OpenRouter API key                                                             |
| ELEVENLABS_API_KEY                     | ElevenLabs API key for audio isolation (optional — enables audio cleanup)      |
| RAILWAY_S3_ENDPOINT                    | Railway Object Storage endpoint (optional — local fallback)                    |
| RAILWAY_S3_REGION                      | Railway S3 region (default: auto)                                              |
| RAILWAY_S3_BUCKET                      | Railway S3 bucket name (optional — triggers S3 mode)                           |
| RAILWAY_S3_ACCESS_KEY_ID               | Railway S3 access key (optional)                                               |
| RAILWAY_S3_SECRET_ACCESS_KEY           | Railway S3 secret key (optional)                                               |
| MANAGER_DATA_MODE                      | `admin` or `mock` (default `admin`)                                            |
| MANAGER_BACKEND_MODE                   | Optional override for data/job backend mode (`admin` or `mock`)                |
| MANAGER_MOCK_SESSION_SECRET            | Required in `mock` mode to sign Manager-issued mock sessions                   |
| MANAGER_MOCK_DATA_PATH                 | Optional mock runtime store path (default `.tmp/mock-cms/store.json`)          |
| WORKFLOW_API_KEY                       | workflow API key (optional, for production durability)                         |
| MANAGER_API_KEY                        | API key for external clients (optional in dev)                                 |
| MANAGER_SESSION_SECRET                 | Secret for Auth-backed `manager-session` cookies                               |
| AUTH_ISSUER_URL                        | Shared Auth issuer URL, normally `https://auth.jesusfilm.org`                  |
| AUTH_MANAGER_CLIENT_ID                 | Manager OAuth client ID registered in Auth                                     |
| AUTH_MANAGER_CLIENT_SECRET             | Manager OAuth client secret                                                    |
| AUTH_MANAGER_SERVICE_CLIENT_ID         | Manager service OAuth client ID for Admin session validation                   |
| AUTH_MANAGER_SERVICE_CLIENT_SECRET     | Manager service OAuth client secret for Admin session validation               |
| ADMIN_MANAGER_API_KEY                  | Legacy bearer key Manager uses for Admin Manager session/read/job contracts    |
| ADMIN_MANAGER_SESSION_URL              | Optional override for Admin Manager session validation endpoint                |
| ADMIN_GRAPHQL_URL                      | Full URL of admin's `/api/graphql` (used by `/api/admin-embeds/*`)             |
| ADMIN_EMBED_TRIGGER_API_KEY            | Bearer key, must match an entry in admin's `WORKFLOW_API_KEYS`                 |
| ADMIN_TRIGGER_API_KEYS                 | CSV of bearer keys admin can use to call `/api/admin-trigger/*` (feat-119 PR2) |
| MASTRA_BASE_URL                        | Internal Mastra runtime URL for transcript embedding launches                  |
| MASTRA_SERVICE_API_KEY                 | Bearer key Manager presents to Mastra service routes                           |
| MASTRA_ENRICHMENT_API_KEY              | Optional dedicated bearer for Mastra video-enrichment dispatches               |
| MASTRA_ENRICHMENT_DISPATCH_TIMEOUT_MS  | Optional short ack-only timeout for video-enrichment dispatch (default 15s)    |
| MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS | Optional timeout for the Manager to Mastra transcript launch call              |
| LAUNCHDARKLY_SDK_KEY                   | Optional server-side LaunchDarkly SDK key                                      |
| FORGE_ENRICHMENT_ENGINE_DEFAULT        | Local fallback for `forge.enrichment.engine` (`true` selects Mastra)           |
| ENRICHMENT_CALLBACK_API_KEYS           | CSV of bearer keys Mastra can use to call `/api/internal/enrichment-callback`  |
| NEXT_PUBLIC_WATCH_URL                  | Public video watch URL (optional)                                              |

## Manager enrichment engine cutover (Mastra Phase 1)

Video enrichment jobs carry an engine stamp in `job.options.engine`. Missing or
corrupt stamps resolve to `workflow`, so old in-flight jobs stay on the legacy
engine while Phase 1 ramps Mastra.

- Runtime flag: `@forge/feature-flags` entry `forge.enrichment.engine`
  (`false=workflow`, `true=mastra`) with local fallback
  `FORGE_ENRICHMENT_ENGINE_DEFAULT`.
- Operator/API override: `GET/PUT /api/admin/engine-flag`, authenticated with
  the Manager service bearer. This process-local override matches the verified
  single-replica Phase 1 window; revisit before scaling Manager above 1 replica.
- Mastra callback receiver: `POST /api/internal/enrichment-callback`, protected
  by `ENRICHMENT_CALLBACK_API_KEYS`. Callback keys must stay disjoint from
  `ADMIN_TRIGGER_API_KEYS`.
- Manual re-drive: `POST /api/jobs/[id]/redispatch` accepts only
  Mastra-stamped jobs and mints a fresh Mastra run through the shared launcher.

## Standalone smoke

The Railway standalone build copies `apps/manager/.next/static` into `apps/manager/.next/standalone/apps/manager/.next/static` before starting `server.js`. Follow that same shape for local standalone smoke tests; without the copied static assets the login page HTML renders but the client JS does not hydrate.
