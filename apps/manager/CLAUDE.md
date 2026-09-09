# apps/manager — VideoForge Manager

## What this app does

AI video enrichment pipeline dashboard. Ingests video assets via Mux, runs enrichment workflows (transcription, translation, chapters, metadata, and source-artifact generation), stores artifacts in Railway S3-compatible Object Storage, and syncs results through Manager/Admin GraphQL contracts. Background transcript and experience embedding generation belongs to Mastra; subtitle translation/retiming execution also belongs to Mastra. Scene embedding sync into Admin is retired, while scene analysis may still produce non-search source artifacts. Manager supplies source artifacts and optional video context, owns job state, displays returned validation/correction summaries, records validation/correction artifacts in manifests, and keeps Mux subtitle sync. Scripture-context detection, gospel-aware subtitle prompt guidance, subtitle scripture accuracy validation, source transcript scripture correction judgment, and optional Bible-source calls stay in Mastra; Manager only applies deterministic exact-match source corrections returned by Mastra.

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

## Triggering admin embedding backfills

Manager exposes one REST endpoint that proxies to apps/admin's active
`triggerTranscriptEmbeddingBackfill` GraphQL mutation:

- `POST /api/admin-embeds/transcript` — body `{ mappingS3Key?,
coreIds?, languages? }`

Admin owns the destination Postgres schema (`video_transcript`,
`video_transcript_chunk`); manager only carries the trigger surface.
Proxy ensures behaviour parity by definition -- single workflow, single
source of truth. The legacy scene embedding proxy is retired; Manager
scene-analysis artifacts must not be synced into Admin scene embeddings.

**Auth (manager-side):** `authenticateRequest` — same Strapi JWT
cookie or `MANAGER_API_KEY` bearer used by every other manager API
route.

**Auth (manager → admin):** `Authorization: Bearer
${ADMIN_EMBED_TRIGGER_API_KEY}` against admin's GraphQL endpoint.
Admin validates via its `WORKFLOW_API_KEYS` allowlist and mints a
request-bound `WORKFLOW_TRIGGER` principal that satisfies only
`write:transcript-embeddings` and the other active workflow-trigger
permissions in Admin.

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

## Smart Crop

AI-assisted 9:16 reframing (plan
`docs/plans/2026-06-09-002-feat-smart-crop-plan.md` — the authoritative
architecture reference and wire-contract source). Manager owns the operator
UI, the durable orchestration (`src/workflows/smartCrop.ts` +
`launchSmartCrop.ts`), job state (`options.smartCrop` discriminator on the
existing `ManagerEnrichmentJob` contract + a `smartCrop` metadata artifact
entry), Mux output asset creation, and artifact addressing. apps/mastra owns
the three AI decisions (`/forge-smart-crop-{plan,align,qa}` — client:
`src/services/mastra-smart-crop.ts`); apps/crop-worker owns
ffprobe/FFmpeg bytes (fingerprint + render — client:
`src/services/crop-worker.ts`, submit + poll with bounded resubmit on 404
job-loss).

- Routes: `POST/GET /api/smart-crop/jobs`,
  `POST /api/smart-crop/jobs/{id}/approve` (canonical plan qa block),
  `POST /api/smart-crop/jobs/{id}/retry` (failed jobs; idempotent steps skip
  completed artifacts). UI at `/dashboard/smart-crop`.
- **Force retry escape hatch:** `POST /api/smart-crop/jobs/{id}/retry` accepts
  an optional `{ "force": true }` body that opts the relaunch out of artifact
  reuse (every step recomputes). This is the recovery path for deterministic
  re-fails — a stored QA verdict `fail` or an alignment gate failure replays
  from the existing artifact on a plain retry forever. Bodiless POST (the UI
  default) keeps `force: false`.
- **Step error classification:** deterministic step failures
  (missing/invalid artifacts, `canonical_plan_not_approved`, `retryable:false`
  client envelopes) throw the workflow SDK's `FatalError` so the runtime does
  NOT auto-retry them (default is 3x); transient failures keep throwing
  `SmartCropStepError` and ride the SDK retries.
- **Provider recovery ownership:** Mastra's shared Smart Crop OpenRouter client
  owns bounded automatic recovery for explicit 429/503 outcomes. Exhausted
  provider recovery, including `provider_rate_limited`, arrives with
  `retryable:false` and becomes `FatalError`; Manager must not immediately
  launch another full provider loop. Manager-to-Mastra `network_error` remains
  retryable because no provider response is known. Last error includes the
  sanitized typed reason and Mastra run id for correlation.
- **Mux output idempotency:** the Mux output step records the created asset id
  in `{assetId}/smart-crop-mux-output-v1.json` IMMEDIATELY after
  `createMuxAsset` (before readiness polling, `ready: false`). Retries resume
  polling the recorded asset instead of creating a duplicate; a resumed asset
  in status `errored` is replaced by a fresh one (record overwritten).
- **Plan checkpointing:** the plan step persists per-batch progress to
  `{assetId}/smart-crop-plan-progress-v1.json` (keyed to the fingerprint's
  `generatedAt`); retries resume from the first incomplete vision batch
  instead of re-paying completed LLM calls. This includes an operator Retry
  after provider recovery exhausts. `force` ignores the checkpoint.
- **Face-first anchoring:** Mastra plan/repair responses may include optional
  `faceVisible` and `faceCenter` segment metadata. Manager preserves those
  fields for artifacts/debugging but does not calculate crop x positions; the
  deterministic Mastra planner already emitted the final keyframes.
- **QA is advisory:** mastra config-shaped QA failures
  (`frame_host_not_allowed`, `provider_config_missing`, `config_missing`,
  `auth_failed`, `provider_auth_failed`) degrade the QA step to `skipped` with
  the reason in the step note + `metadata.qa.unavailableReason` — renders and
  Mux output proceed. A genuine verdict `fail` still fails the job.
- **Timeline-map provenance:** the align step stamps
  `provenance: { canonicalPlanGeneratedAt, canonicalFingerprintGeneratedAt,
localizedFingerprintGeneratedAt }` into the timeline-map artifact and only
  reuses an existing map when the provenance matches the current artifacts
  (legacy maps without provenance are recomputed). It also fails
  deterministically with `source_dimensions_mismatch` when the canonical plan
  and localized fingerprint disagree on source width/height.
- Steps are `smart_crop_*` members of `WorkflowStepName`; initial inventories
  come from `buildSmartCropInitialSteps(kind)` in `src/lib/workflow-steps.ts`.
- **Storage prefix caveat:** smart-crop artifacts live under
  `options.smartCrop.assetId` (NOT necessarily `job.muxAssetId`). The artifact
  download route resolves the prefix via `getJobArtifactStorageAssetId` in
  `src/lib/job-artifacts.ts`.
- Local mode degradation: `createPresignedArtifactUrl` returns `null` without
  `RAILWAY_S3_BUCKET`; the QA and Mux-output steps then mark themselves
  skipped with reason `storage_presign_unavailable`.
- **Operator-actionable errors:** `errorMessage()` (exported from
  `smartCrop.ts`) reads `.message` defensively rather than gating on
  `instanceof Error` — the SDK's `FatalError` is NOT an `instanceof Error` in
  the Next.js workflow runtime (it surfaces as `{ fatal: true, name }` with the
  message on a non-enumerable getter), so an instanceof gate showed
  "Unknown error" instead of the crop-worker/mastra failure detail. The bug
  does not reproduce under vitest (where `FatalError` IS an instanceof Error),
  so the regression is pinned by a direct `errorMessage` unit test against the
  non-Error shape.
- **Local mock-mode testing caveat (`MANAGER_DATA_MODE=mock`):** the job
  **detail** page (`/dashboard/smart-crop/[id]`) may 404 for jobs created after
  the dev server started. `MockCmsStore` (`src/cms/mock-store.ts`) caches state
  in-memory and never re-reads the file, and Next dev hands the route handler
  and the page server-component separate module instances — so a freshly
  created job is visible in the list (fresh-read request) but missing from the
  detail render's stale cache until restart. This is pre-existing mock-store
  behavior, NOT a Smart Crop bug: production runs `admin` mode where `getJob`
  hits the live Admin DB with no staleness.

Env (all optional at schema load; job creation returns 503 `config_missing`
when unset):

| Variable                     | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| CROP_WORKER_BASE_URL         | crop-worker base URL                                |
| CROP_WORKER_API_KEY          | caller-side single bearer for crop-worker           |
| MASTRA_SMART_CROP_TIMEOUT_MS | per-call mastra smart-crop timeout (default 120000) |

**Deploy ordering (receiver first):** set `CROP_WORKER_API_KEYS` on
crop-worker, verify a wrong bearer gets 401 (not 503), THEN set manager's
`CROP_WORKER_BASE_URL` + `CROP_WORKER_API_KEY`. Reverse order produces a dead
minute where manager's first call 401s. Mastra needs no new bearer (existing
`MASTRA_SERVICE_API_KEY` pair), but **production mastra DOES need
`SMART_CROP_IMAGE_URL_ALLOWED_HOSTS=image.mux.com,<host of manager's
RAILWAY_S3_ENDPOINT>` set BEFORE the first job** — QA frames are presigned
Railway S3 URLs, and mastra's default allowlist (`image.mux.com` only)
rejects every QA call with `frame_host_not_allowed`. Manager degrades that to
a skipped (advisory) QA step rather than a failed job, but the QA gap stays
until the allowlist is extended.

## Retired Shorts authoring

Studio at `/dashboard/shorts` uses `features/video-studio` and Admin-owned projects.
The legacy `/api/shorts` creation, caption draft, clone and render workflow was retired
in feat-462. Source captions come from the exact library edition/language track;
legacy Whisper transcription, the 180-second limit and last-write-wins drafts do not
apply. Historical job options/step literals remain for generic job readers and
artifact identity; they cannot launch Shorts work. No stored data is migrated or
deleted by retirement. Active devotional tools still use the separate Shorts Worker.

See `docs/plans/2026-09-08-feat-462-legacy-shorts-retirement.md` for slice scope and
remaining release acceptance. Keep the Studio routes, shared composition/font
packages, exact Remotion version lockstep and React-free server imports intact.

## Common pitfalls

- The workflow SDK package is `workflow` (not `@workflowdev/sdk`). See https://useworkflow.dev/.
- OpenRouter does not expose a Whisper transcription endpoint — use a supported model or switch to Mux's built-in transcription (`input[].generated_subtitles`).
- Railway S3 requires `forcePathStyle: true` in the S3Client config.
- Audio cleanup extracts original audio with `ffmpeg` before calling ElevenLabs. The manager Railway service uses the repo-root `nixpacks.toml` to add `ffmpeg` to the NIXPACKS setup phase; the helper still throws a clear error if the binary is missing.
- Job state is moving to Admin-owned Manager contracts. The `src/lib/state.ts` module preserves the same `createJob`/`getJob`/`listJobs`/`updateJob`/`updateStepStatus` API while routing by backend mode.
- Manager now enables the workflow SDK build plugin in `next.config.ts`, and enrichment entrypoints dispatch through `src/workflows/launchVideoEnrichment.ts` via `start()` from `workflow/api`. The workflow runtime is no longer inert.
- Workflow-safe authoring still matters: keep Node-only imports and heavy service modules behind `"use step"` boundaries. A built app will reject workflow files that pull Node-only modules into the top-level workflow body. See https://useworkflow.dev/.

## Environment variables (Doppler project: forge-manager)

| Variable                                          | Description                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| MUX_TOKEN_ID                                      | Mux API token ID                                                                              |
| MUX_TOKEN_SECRET                                  | Mux API token secret                                                                          |
| OPENROUTER_API_KEY                                | OpenRouter API key                                                                            |
| ELEVENLABS_API_KEY                                | ElevenLabs API key for audio isolation (optional — enables audio cleanup)                     |
| RAILWAY_S3_ENDPOINT                               | Railway Object Storage endpoint (optional — local fallback)                                   |
| RAILWAY_S3_REGION                                 | Railway S3 region (default: auto)                                                             |
| RAILWAY_S3_BUCKET                                 | Railway S3 bucket name (optional — triggers S3 mode)                                          |
| RAILWAY_S3_ACCESS_KEY_ID                          | Railway S3 access key (optional)                                                              |
| RAILWAY_S3_SECRET_ACCESS_KEY                      | Railway S3 secret key (optional)                                                              |
| MANAGER_DATA_MODE                                 | `admin` or `mock` (default `admin`)                                                           |
| MANAGER_BACKEND_MODE                              | Optional override for data/job backend mode (`admin` or `mock`)                               |
| MANAGER_MOCK_SESSION_SECRET                       | Required in `mock` mode to sign Manager-issued mock sessions                                  |
| MANAGER_MOCK_DATA_PATH                            | Optional mock runtime store path (default `.tmp/mock-cms/store.json`)                         |
| WORKFLOW_API_KEY                                  | workflow API key (optional, for production durability)                                        |
| MANAGER_API_KEY                                   | API key for external clients (optional in dev)                                                |
| MANAGER_SESSION_SECRET                            | Secret for Auth-backed `manager-session` cookies                                              |
| AUTH_ISSUER_URL                                   | Shared Auth issuer URL, normally `https://auth.jesusfilm.org`                                 |
| AUTH_MANAGER_CLIENT_ID                            | Manager OAuth client ID registered in Auth                                                    |
| AUTH_MANAGER_CLIENT_SECRET                        | Manager OAuth client secret                                                                   |
| AUTH_MANAGER_SERVICE_CLIENT_ID                    | Manager service OAuth client ID for Admin session validation                                  |
| AUTH_MANAGER_SERVICE_CLIENT_SECRET                | Manager service OAuth client secret for Admin session validation                              |
| ADMIN_MANAGER_API_KEY                             | Legacy bearer key Manager uses for Admin Manager session/read/job contracts                   |
| ADMIN_MANAGER_SESSION_URL                         | Optional override for Admin Manager session validation endpoint                               |
| SEO_ASSERTION_ENVIRONMENT                         | Environment bound into delegated SEO approval assertions                                      |
| SEO_APPROVAL_KEY_ID                               | Active Ed25519 key ID used only for interactive SEO decisions                                 |
| SEO_APPROVAL_PRIVATE_KEY                          | PKCS8 Ed25519 private key matching an Admin verifier entry                                    |
| ADMIN_GRAPHQL_URL                                 | Full URL of admin's `/api/graphql` (used by `/api/admin-embeds/*`)                            |
| ADMIN_EMBED_TRIGGER_API_KEY                       | Bearer key, must match an entry in admin's `WORKFLOW_API_KEYS`                                |
| ADMIN_TRIGGER_API_KEYS                            | CSV of bearer keys admin can use to call `/api/admin-trigger/*` (feat-119 PR2)                |
| MASTRA_BASE_URL                                   | Internal Mastra runtime URL for transcript embedding and subtitle launches                    |
| MASTRA_SERVICE_API_KEY                            | Bearer key Manager presents to Mastra service routes                                          |
| MASTRA_TRANSCRIPT_EMBEDDING_TIMEOUT_MS            | Optional timeout for the Manager to Mastra transcript launch call                             |
| MASTRA_SUBTITLE_ENRICHMENT_TIMEOUT_MS             | Optional timeout for the Manager to Mastra subtitle enrichment launch call                    |
| MASTRA_TRANSCRIPT_SCRIPTURE_CORRECTION_TIMEOUT_MS | Optional timeout for the Manager to Mastra source transcript scripture correction launch call |
| CROP_WORKER_BASE_URL                              | crop-worker base URL (optional — enables Smart Crop)                                          |
| CROP_WORKER_API_KEY                               | Bearer key Manager presents to crop-worker (optional — enables Smart Crop)                    |
| MASTRA_SMART_CROP_TIMEOUT_MS                      | Optional per-call timeout for Mastra smart-crop launches (default 120000)                     |
| NEXT_PUBLIC_WATCH_URL                             | Public video watch URL (optional)                                                             |

## SEO workspace

`/dashboard/seo` is the authenticated, shared operator queue for the Mastra SEO
Marketing Agent. Manager reads the Admin-owned experiment ledger and signs only
short-lived, actor-bound approve, reject, lesson-review, and reconciliation
assertions. Service API keys cannot perform those actions. Editorial approval
creates an Admin draft; it does not publish. Engineering approval queues the
exact approved brief; it does not prove deployment or activation.

Keep the approval private key out of browser bundles and prompts. Rotate by
adding the new public key to Admin first, switching Manager's key ID/private
key, and removing the old verifier after the maximum assertion lifetime. With
no approval key, the workspace remains read-only.

The `Runs` view is the bounded audit log for this agent. Its index requests
small run summaries only; `/dashboard/seo/runs/[runId]` lazily fetches one
versioned report with the exact safe Search Console request scope, ranked query
decisions, truncation counts, and current proposal outcomes. Provider response
bodies, credentials, headers, and cookies never belong in the report. Query and
request detail is compacted after 29 days by the existing Admin search-trace
retention job, while run totals, report state, and proposal references remain.

## Standalone smoke

The Railway standalone build copies `apps/manager/.next/static` into `apps/manager/.next/standalone/apps/manager/.next/static` and `apps/manager/public` into `apps/manager/.next/standalone/apps/manager/public` before starting `server.js`. Follow that same shape for local standalone smoke tests; without the copied static assets the login page HTML renders but the client JS does not hydrate, and without the copied public assets regional images 404 in standalone mode.

Production Manager may still be governed by Railway dashboard-level overrides instead of `apps/manager/railway.toml`; verify the effective Railway config before assuming this file is honored. The shell brand assets `/jesusfilm-sign.svg` and `/favicon.svg` are also served by app route handlers so the login shell keeps rendering if the runtime image omits `apps/manager/public`.

## Studio authoring foundation

For Studio project commands, history, approval or publication changes, read
`docs/solutions/database-issues/studio-command-revisions-and-publication-latch.md`
from the repository root. Admin owns the durable module; Manager uses
`apps/manager/src/backend/studio-client.ts` through Admin GraphQL. The neutral contract is
`@forge/studio-contracts`. The internal publication seam has no public publish
mutation until feat-460 supplies its catalog/render/approval checks.

## Standalone Studio editor (feat-456)

`src/features/video-studio/` replaces the Shorts product at `/dashboard/shorts`.
The authenticated command adapter is `src/backend/studio-interactive.ts`; the
browser supplies commands and expected revisions, while the server signs the
validated session user's identity. Admin checks current operator membership.
Delegated OAuth attribution does not grant interactive review authority.

The preview broker is `src/services/studio-broker.ts`; generated code executes in
`apps/studio-preview`, in a sandboxed iframe on a different registrable site.
Read `docs/solutions/security-issues/studio-standalone-editor-runtime.md` before
changing preview isolation, source reuse, deployment configuration or save recovery.

| Variable                       | Purpose                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| STUDIO_ENVIRONMENT             | Explicit local/preview/production assertion binding; use separate keys per environment |
| STUDIO_INTERACTIVE_KEY_ID      | Active Manager Ed25519 signing key ID                                                  |
| STUDIO_INTERACTIVE_PRIVATE_KEY | PKCS8 key; matching Admin `STUDIO_INTERACTIVE_PUBLIC_KEYS` JSON keyring                |
| STUDIO_PREVIEW_ORIGIN          | Public, distinct-site HTTPS preview origin; loopback allowed for local verification    |
| STUDIO_PREVIEW_SERVICE_URL     | Server-reachable preview service URL                                                   |
| STUDIO_PREVIEW_API_KEY         | Dedicated random service credential, also authenticates retained broker codec proofs   |
| STUDIO_FFMPEG_PATH             | Explicit provisioned FFmpeg 7.0.2 proof binary; never a generated-code executor        |
| STUDIO_FFPROBE_PATH            | Explicit provisioned probe; local verification uses Remotion 4.0.475 bundled n7.1      |

The existing root Nixpacks setup provisions FFmpeg generally. Studio's pinned
7.0.2 binary must be supplied as a deployment artifact and selected explicitly;
a system binary is not claimed to reproduce the pinned proof automatically.
`ADMIN_MANAGER_API_KEY` authorizes trusted source materialization only; it is not
used to attribute human commands. Production render execution remains feat-460.

For Studio hosted instructions, OAuth MCP authority, or execution admission, read
`docs/solutions/security-issues/studio-native-agent-admission.md` from the repository
root before changing those boundaries.

## Contained Studio rendering (feat-460)

`STUDIO_RENDER_SERVICE_URL` is the dedicated private execution-service origin
(`*.railway.internal`; loopback for isolated local verification).
`STUDIO_RENDER_PRIVATE_KEY` is the broker's Ed25519 admission key; only its
public counterpart belongs in the execution container. The Manager startup
reconciler runs only when both are configured. Browser commands enqueue/poll;
the server owns the900-second cumulative render profile,920-second private
request and1200-second durable lease. Preparation is bounded90seconds and
retention60seconds. Mux readiness/publication is a distinct durable phase.
Do not route this request through the public edge or put provider/DB/storage
credentials in the executor. Changes to service settings require normal release
approval; adding these code fields does not authorize deployment.

`STUDIO_MUX_INGEST_ENABLED=true` enables the separate durable Mux processing
reconciler; enabling it is an external spending/release step, never a local
validation requirement. `STUDIO_ASSET_INGEST_ORIGIN` is the public HTTPS Admin
origin for short-lived retained-byte read capabilities consumed by Mux. Signed
Studio ingest never uses the legacy public playback helper. Consumed ambiguous
creates remain unresolved and cannot automatically create another paid asset.
The processing loop uses a bounded keyset cursor independently of long renders.

### VM outbound Studio render gateway

Before changing pool authentication, retained-output settlement or claim pause
behavior, read `docs/plans/2026-09-08-001-feat-studio-vm-execution-plan.md`,
“Outbound gateway and retained-output protocol.” The scoped route is
`/api/shorts/render-pool/{claim,input,owns,retain,finish,receipt}`. Environment variables
are defined in `src/config/env.ts`; `STUDIO_RENDER_POOL_ENABLED` gates new
assignment selection, while configured historical receipt recovery remains
available. Admin remains the canonical job authority.
