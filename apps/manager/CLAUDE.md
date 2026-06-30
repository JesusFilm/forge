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
- **Mux output idempotency:** the Mux output step records the created asset id
  in `{assetId}/smart-crop-mux-output-v1.json` IMMEDIATELY after
  `createMuxAsset` (before readiness polling, `ready: false`). Retries resume
  polling the recorded asset instead of creating a duplicate; a resumed asset
  in status `errored` is replaced by a fresh one (record overwritten).
- **Plan checkpointing:** the plan step persists per-batch progress to
  `{assetId}/smart-crop-plan-progress-v1.json` (keyed to the fingerprint's
  `generatedAt`); retries resume from the first incomplete vision batch
  instead of re-paying completed LLM calls. `force` ignores the checkpoint.
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

## Shorts Studio

Vertical 9:16 shorts with word-level whisper captions, rendered via Remotion
(plan `docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md` — the
authoritative architecture and wire-contract source; roadmap feat-178).
Topology clones Smart Crop: manager owns the operator UI
(`/dashboard/shorts`), durable orchestration
(`src/workflows/shortsStudio.ts` + `launchShorts.ts` — `options.shorts`
discriminator on the existing JobRecord, ZERO admin schema changes), draft
state, propsHash computation, and Mux output asset creation;
apps/shorts-worker owns the bytes (ffmpeg clip trim + whisper transcription
in a prepare lane, Remotion renders in a render lane — client:
`src/services/shorts-worker.ts`, submit + poll with bounded resubmit and
queue_full backoff, poll ceilings prepare 50min / render 80min strictly
ABOVE the worker's 45/70min deadlines); `packages/shorts-compositions` is
the shared composition consumed by both the browser `<Player>` preview and
the worker render (parity by construction).

- Routes: `POST/GET /api/shorts/jobs` (create validates clip bounds 5–180s
  against live Mux duration — never `mux_videos.duration`),
  `GET /api/shorts/videos/[coreId]` (eligibility with reasons
  `missing_mux_asset | playback_not_public`), `POST+GET
/api/shorts/jobs/[id]/draft`, `POST /api/shorts/jobs/[id]/render`,
  `POST /api/shorts/jobs/[id]/retry` (`{force?: "prepare" | "render"}`;
  force-prepare responses surface `discardsCaptionEdits: true`),
  `GET /api/shorts/jobs/[id]/media/[clip|output]` (streaming).
- **Phase lifecycle + single-writer rule:** UI/API source of truth is
  `ShortsPhase` in the `shorts` metadata artifact entry
  (`src/lib/shorts-report.ts`): `queued → preparing → ready_for_review →
rendering → mux_processing → completed`, failures
  `prepare_failed | render_failed`. The WORKFLOWS own all phase
  transitions; routes write launching intents only. Prepare ends with
  `job.status = "completed"` + phase `ready_for_review` — shorts routes
  gate on PHASE, not job status (the generic retry route never sees shorts
  semantics). Render/retry launches claim an in-memory TTL slot
  (`src/lib/shorts-claim.ts` — sync-claim before any await, try/finally
  release).
- **Draft / provenance / propsHash contracts:** whisper captions
  (`shorts-captions-v1`) are immutable; operator edits live in
  `shorts-draft-v1.json` — last-write-wins with SERVER-side `draftVersion`
  increment and `captionsGeneratedAt` provenance (`src/lib/shorts-draft.ts`;
  `updatedBy` derived from the authenticated actor, never the body).
  Force-prepare regenerates captions → provenance mismatch → draft reset:
  the documented caption-edit discard. Render hard-gates
  `draft_provenance_mismatch`. `propsHash` = sha256 over canonical
  (sorted-key) JSON of `{clip: {assetId, artifactType: "shorts-clip-v1"},
props}` (`src/lib/shorts-props.ts`) — `clipUrl` is excluded by
  construction and the worker treats the hash as opaque. The render
  workflow REUSES an existing output when the stored render meta echoes the
  same propsHash and the output MP4 exists (e.g. relaunch after a
  Mux-output failure never re-pays a Remotion render); the worker's
  `render:{assetId}:{propsHash}` dedupe re-attaches identical in-flight
  submits. Mux output is record-before-poll
  (`shorts-mux-output-v1.json` written before readiness polling,
  errored → recreate; presign-unavailable → step skipped, job completes
  with `output.ready: false`).
- **Streaming media route, not the artifact route:** shorts MP4s are served
  ONLY by `GET /api/shorts/jobs/[id]/media/[clip|output]` — fixed logical
  literals, Range-capable (single + suffix ranges → 206, multi-range → 416),
  stream-never-buffer, 60s in-process jobId→prefix cache, `Cache-Control:
private, max-age=3600`. The legacy buffering artifact route must NEVER
  serve shorts media: `readArtifact` buffers whole objects in memory and the
  rendered output is 180–360MB.
- **Import rule:** manager server/workflow code imports ONLY the pure
  subpaths `@forge/shorts-compositions/{schema,captions,registry}` (the
  compositions package's module-graph test pins schema/captions as
  React/Remotion-free). The package root (`ShortComposition`, Player
  consumers) is imported ONLY inside `next/dynamic` `ssr:false` client
  components (`src/features/shorts/short-preview.tsx` — memoized
  inputProps, draft commits debounced 250ms, Player never keyed by
  `draftVersion`). `remotion`/`@remotion/*` are pinned EXACT across
  manager / worker / compositions — the lockstep test fails on drift.
- Whisper language resolution: `src/lib/whisper-language.ts` (BCP-47 →
  whisper ISO-639-1; aliases `jv→jw`, `nb→no`, `fil→tl`; `null` =
  unsupported → captions-less short annotated
  `transcription_unsupported_language`; no-audio clips annotate
  `transcription_skipped_no_audio`). ElevenLabs cue-level transcription
  (enrichment) and whisper word-level captions (shorts) deliberately
  coexist — word timings ARE the shorts product; do not "unify" them.
- **Templates** (source of truth: `SHORT_TEMPLATES` in
  `packages/shorts-compositions/src/templates/registry.ts` — per-template
  default knobs applied when an operator PICKS a template in the editor):

  | id      | label | accentColor | captionPosition | captionFont  | waveformStyle | showCaptions |
  | ------- | ----- | ----------- | --------------- | ------------ | ------------- | ------------ |
  | `focus` | Focus | `#f97316`   | `center`        | `montserrat` | `bars`        | `true`       |
  | `frame` | Frame | `#f97316`   | `lower`         | `montserrat` | `bars`        | `true`       |

  Distinct from the freshly-prepared INITIAL draft (`buildInitialDraft` in
  `src/lib/shorts-draft.ts`, plan decision 14): Focus template, brand-yellow
  `#facc15` accent, `lower` caption band.

- Licensing: JFP is a non-profit → free Remotion license per Remotion's
  LICENSE.md; `acknowledgeRemotionLicense` is set on the Player. Re-verify
  at Remotion 5.0.

Env (both `.optional()` at schema load; shorts routes return 503
`config_missing` when unset):

| Variable               | Description                                 |
| ---------------------- | ------------------------------------------- |
| SHORTS_WORKER_BASE_URL | shorts-worker base URL                      |
| SHORTS_WORKER_API_KEY  | caller-side single bearer for shorts-worker |

**Deploy ordering (receiver first):** deploy the shorts-worker Railway
service (Dockerfile builder, Config-as-code Path set, numReplicas=1), set
`SHORTS_WORKER_API_KEYS` there (a DISTINCT secret from
`CROP_WORKER_API_KEYS`), verify a wrong bearer gets 401 (not 503), THEN set
manager's `SHORTS_WORKER_BASE_URL` + `SHORTS_WORKER_API_KEY`. Full checklist
(container smoke, Dockerfile.dockerignore caveat):
`apps/shorts-worker/CLAUDE.md`.

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
| SHORTS_WORKER_BASE_URL                            | shorts-worker base URL (optional — enables Shorts Studio)                                     |
| SHORTS_WORKER_API_KEY                             | Bearer key Manager presents to shorts-worker (optional — enables Shorts Studio)               |
| NEXT_PUBLIC_WATCH_URL                             | Public video watch URL (optional)                                                             |

## Standalone smoke

The Railway standalone build copies `apps/manager/.next/static` into `apps/manager/.next/standalone/apps/manager/.next/static` and `apps/manager/public` into `apps/manager/.next/standalone/apps/manager/public` before starting `server.js`. Follow that same shape for local standalone smoke tests; without the copied static assets the login page HTML renders but the client JS does not hydrate, and without the copied public assets regional images 404 in standalone mode.

Production Manager may still be governed by Railway dashboard-level overrides instead of `apps/manager/railway.toml`; verify the effective Railway config before assuming this file is honored. The shell brand assets `/jesusfilm-sign.svg` and `/favicon.svg` are also served by app route handlers so the login shell keeps rendering if the runtime image omits `apps/manager/public`.
