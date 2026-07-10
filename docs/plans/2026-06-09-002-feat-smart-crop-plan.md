---
title: "Smart Crop — AI-assisted video reframing (canonical plan + localized reuse)"
type: feat
status: active
date: 2026-06-09
origin: PRD provided by vlad (Smart Crop for Forge, 2026-06-09)
---

# Smart Crop — canonical crop plans, localized reuse, FFmpeg render worker

## Summary

Smart Crop converts Mux-hosted videos into 9:16 vertical outputs while preserving
the main subject. The expensive AI work (per-shot crop intent) runs ONCE against a
canonical master; localized language versions reuse the approved canonical crop
plan through deterministic shot alignment plus confidence gates.

Ownership follows the repo's established law (manager-source / mastra-AI /
worker-bytes):

- **apps/manager** — operator UI, durable job orchestration (`workflow` SDK),
  job state via the existing `JobRecord` / `ManagerEnrichmentJob` contract,
  Mux asset creation for outputs, artifact addressing, retry/approve controls.
- **apps/mastra** — three bounded synchronous AI/decision workflows:
  `smart-crop-plan` (vision LLM crop intent → deterministic planner),
  `smart-crop-align` (shot alignment + confidence gates),
  `smart-crop-qa` (vision LLM preview review). HTTP contracts + local Zod
  schemas only; no S3, no Mux credentials.
- **apps/crop-worker** (NEW) — plain node:http service owning ffprobe/FFmpeg:
  visual fingerprinting (shot detection + perceptual hashes) and rendering
  (per-segment crop/scale/encode + concat + preview frames), reading/writing
  the shared Railway S3 artifact bucket directly.

### Deliberate deviations from the PRD (repo-reality)

1. **Mastra does not own the end-to-end pipeline.** Mastra workflows run
   synchronously inside HTTP requests (~120s caller budget) and have no S3/Mux
   access. The durable end-to-end orchestration lives in manager's `workflow`
   SDK pipeline (same as `videoEnrichment`); Mastra owns the AI decisions.
2. **Polling instead of worker→manager progress callbacks.** Manager's durable
   workflow polls `GET /jobs/{workerJobId}` on crop-worker (precedent:
   `waitForReadySubtitleTrack`). Single mechanism, restart-resilient, no new
   inbound auth surface on manager. Progress still reaches the UI: the polling
   step writes progress into job step details → SSE.
3. **Flat artifact keys, not `smart-crop/...` nesting.** Storage validator
   only allows `{assetId}/{artifactType}.{ext}`. All smart-crop artifacts use
   `{assetId}/smart-crop-*.{json,mp4,jpg}` so manager's existing
   readArtifact/download routes can serve them.
4. **Job state reuses `ManagerEnrichmentJob`** with `options.smartCrop` as the
   kind discriminator (admin stores options/steps as JSON; step name is a plain
   GraphQL String — no admin deploy needed). Job/step statuses stay within the
   closed enums; smart-crop phase detail lives in a `smartCrop` metadata
   artifact entry.
5. **MVP scope:** 9:16 only; horizontal-only panning (crop height = source
   height); Tier 1–2 alignment (duration identity + shot-sequence/dhash
   matching; fingerprint phash data is captured to enable Tier 3 later);
   preview QA via AI; operator approval of canonical plans; full render +
   Mux output for localized jobs; retry without rerunning AI (artifact reuse).

## Requirements

- Canonical job: fingerprint → crop plan (AI, chunked per shot batch) →
  preview render → AI QA → operator review/approve.
- Localized job: fingerprint (localized) → align to canonical fingerprint →
  confidence gates → preview render → AI QA → full render → Mux output asset.
- Gates (defaults): minOverallConfidence 0.92, minShotConfidence 0.85,
  maxUnmappedDurationPercent 5, maxConsecutiveUnmappedSeconds 20,
  maxTimingDriftSecondsPerShot 5. Gate failure → job fails with an
  operator-actionable alignment report (no silent render).
- Every decision stored as a versioned, reviewable JSON artifact.
- Retry of a failed job must reuse existing artifacts (no repeated AI calls,
  no re-render of completed outputs) unless `force` is set.
- Render runs outside manager's process. Failed renders never crash manager.
- Token usage aggregated into job metadata.

## Identity model (CONCEPTS.md-aligned)

- `assetId` — operator-facing id and storage-key prefix (same role as
  enrichment; defaults to the Mux asset id when the operator doesn't supply
  one). Canonical and localized videos each have their own `assetId`.
- `muxAssetId` / `playbackId` — source stream identity (public playback).
- `language` — language slug for localized jobs (provenance only; keys are
  per-assetId so no locale suffix needed).

## Artifact contracts (exact)

All artifacts written through the established storage layer key scheme
`{assetId}/{artifactType}.{ext}`. Versioned `kind` discriminators are the
cross-app wire contract — literals must match exactly in manager, mastra, and
crop-worker (producer-consumer report-file contract rule).

### 1. Visual fingerprint — `{assetId}/smart-crop-fingerprint-v1.json`

Producer: crop-worker. Consumers: manager (pass-through), mastra (align).

```json
{
  "version": 1,
  "kind": "smart-crop-fingerprint",
  "assetId": "asset123",
  "source": { "width": 1920, "height": 1080, "durationSeconds": 7200.04 },
  "sampling": { "hashFps": 1, "hashSize": 8, "sceneThreshold": 0.3 },
  "shots": [
    {
      "shotId": "shot_00001",
      "start": 0,
      "end": 12.48,
      "representativeHashes": [{ "time": 6.0, "dhash": "9fc8a1b2c3d4e5f6" }]
    }
  ],
  "tool": "crop-worker-fingerprint-v1",
  "generatedAt": "2026-06-09T00:00:00.000Z"
}
```

- `shotId` = `shot_` + zero-padded 5-digit 1-based index.
- `dhash` = 64-bit difference hash, 16 hex chars, from 9x8 grayscale frames.
- `representativeHashes` = up to 3 hashes per shot (start/middle/end seconds).

### 2. Canonical crop plan — `{assetId}/smart-crop-plan-9x16-v1.json`

Producer: manager (assembles mastra plan-chunk responses). Consumers:
crop-worker (render), manager UI.

```json
{
  "version": 1,
  "kind": "smart-crop-canonical-plan",
  "assetId": "asset123",
  "muxAssetId": "mux_abc",
  "playbackId": "pb_abc",
  "source": { "width": 1920, "height": 1080, "durationSeconds": 7200.04 },
  "target": { "aspectRatio": "9:16", "width": 1080, "height": 1920 },
  "strategy": {
    "cropMode": "auto",
    "plannerVersion": "smart-crop-planner-v1",
    "model": "qwen/qwen2.5-vl-72b-instruct"
  },
  "segments": [
    {
      "shotId": "shot_00421",
      "canonicalStart": 124.2,
      "canonicalEnd": 139.8,
      "mode": "group",
      "primarySubject": "Jesus",
      "secondarySubjects": ["disciples"],
      "avoidCutting": ["faces"],
      "confidence": 0.94,
      "cropKeyframes": [
        { "progress": 0, "x": 520, "y": 0, "width": 606, "height": 1080 },
        { "progress": 1, "x": 560, "y": 0, "width": 606, "height": 1080 }
      ]
    }
  ],
  "usage": { "inputTokens": 0, "outputTokens": 0 },
  "qa": { "status": "draft" },
  "generatedAt": "2026-06-09T00:00:00.000Z"
}
```

- `qa.status` ∈ `"draft" | "approved" | "rejected"`; approval adds
  `approvedBy` + `approvedAt`. Localized full render requires `approved`.
- Crop window: `width` = largest even integer ≤ `source.height * 9 / 16`,
  `height` = `source.height`, `y` = 0 (horizontal-only MVP).
- `mode` ∈ `"speaker" | "group" | "object" | "slide_aware" | "action" | "center_fallback"`.

### 3. Timeline map — `{localizedAssetId}/smart-crop-timeline-map-v1.json`

Producer: manager (from mastra align response). Consumer: crop-worker.

```json
{
  "version": 1,
  "kind": "smart-crop-timeline-map",
  "canonicalAssetId": "asset123",
  "localizedAssetId": "asset456",
  "language": "uk",
  "mappingMethod": "shot-sequence",
  "overallConfidence": 0.97,
  "unmappedDurationPercent": 1.8,
  "maxConsecutiveUnmappedSeconds": 4.2,
  "segments": [
    {
      "canonicalShotId": "shot_00421",
      "canonicalStart": 124.2,
      "canonicalEnd": 139.8,
      "localizedStart": 126.8,
      "localizedEnd": 143.1,
      "confidence": 0.98
    }
  ],
  "gate": {
    "passed": true,
    "failures": [],
    "config": {
      "minOverallConfidence": 0.92,
      "minShotConfidence": 0.85,
      "maxUnmappedDurationPercent": 5,
      "maxConsecutiveUnmappedSeconds": 20,
      "maxTimingDriftSecondsPerShot": 5
    }
  },
  "warnings": [],
  "generatedAt": "2026-06-09T00:00:00.000Z"
}
```

- `mappingMethod` ∈ `"identical-duration" | "shot-sequence"` (MVP tiers).
- Manager additionally stamps an additive `provenance` block
  (`{ canonicalPlanGeneratedAt, canonicalFingerprintGeneratedAt, localizedFingerprintGeneratedAt }`)
  when writing the map; the align step only reuses an existing map when this
  provenance matches the current artifacts (legacy maps without provenance are
  recomputed). crop-worker reads the map with a loose schema, so the extra
  field is wire-safe.

### 3b. Manager-internal working artifacts (not cross-app contracts)

- `{assetId}/smart-crop-plan-progress-v1.json` — `kind: "smart-crop-plan-progress"`;
  per-batch checkpoint of the plan step (`fingerprintGeneratedAt`, `batchSize`,
  `totalBatches`, `completedBatches`, `segments`, `usage`, `model`). Lets a
  retried/restarted plan step resume from the first incomplete mastra batch
  instead of redoing all AI calls; ignored once the final plan exists.
- `{assetId}/smart-crop-mux-output-v1.json` — durable record of the created
  output Mux asset (`muxAssetId`, `ready`, `playbackId?`), written immediately
  after `createMuxAsset` and BEFORE readiness polling so a retry resumes
  polling the same asset instead of creating a duplicate.

### 4. QA report — `{assetId}/smart-crop-qa-9x16-v1.json`

Producer: manager (from mastra QA response).

```json
{
  "version": 1,
  "kind": "smart-crop-qa-report",
  "assetId": "asset123",
  "renderMode": "preview",
  "verdict": "pass",
  "issues": [
    {
      "severity": "warning",
      "description": "Subject slightly off-center in opening shot",
      "atSeconds": 4
    }
  ],
  "frameCount": 6,
  "model": "google/gemini-2.5-flash",
  "usage": { "inputTokens": 0, "outputTokens": 0 },
  "generatedAt": "2026-06-09T00:00:00.000Z"
}
```

- `verdict` ∈ `"pass" | "needs_repair" | "fail"`. `severity` ∈ `"info" | "warning" | "critical"`.
- QA is advisory in MVP: `fail` marks the QA step failed (operator decides);
  `needs_repair`/`pass` complete the step with the report attached.

### 5. Render report — `{assetId}/smart-crop-render-report-9x16-{mode}.json` (`mode` = `preview` | `full`)

Producer: crop-worker.

```json
{
  "version": 1,
  "kind": "smart-crop-render-report",
  "assetId": "asset123",
  "mode": "preview",
  "target": { "aspectRatio": "9:16", "width": 1080, "height": 1920 },
  "segmentsRendered": 6,
  "segmentsPlanned": 6,
  "outputDurationSeconds": 88.4,
  "outputBytes": 73400320,
  "renderSeconds": 121.7,
  "previewFrameArtifactTypes": ["smart-crop-preview-frame-9x16-001"],
  "warnings": [],
  "tool": "crop-worker-render-v1",
  "generatedAt": "2026-06-09T00:00:00.000Z"
}
```

### 6. Video/frame artifacts

- Preview video: `{assetId}/smart-crop-preview-9x16.mp4`
- Full output: `{assetId}/smart-crop-output-9x16.mp4`
- Preview QA frames: `{assetId}/smart-crop-preview-frame-9x16-{NNN}.jpg` (NNN = 001..)

## Crop-worker HTTP API (exact)

Auth: `Authorization: Bearer <key>` against `CROP_WORKER_API_KEYS` CSV
(timing-safe full-list compare; 503 `{ "error": "config_missing" }` when env
unset in production, non-production bypass when unset; 401 on bad bearer).

### `GET /health` (unauthenticated)

`{ "ok": true, "service": "crop-worker" }`

### `POST /jobs` → 202

```json
{
  "kind": "fingerprint",
  "jobId": "<manager job id>",
  "assetId": "asset123",
  "source": { "url": "https://stream.mux.com/pb_abc.m3u8" }
}
```

```json
{
  "kind": "render",
  "jobId": "<manager job id>",
  "assetId": "asset456",
  "source": { "url": "https://stream.mux.com/pb_uk.m3u8" },
  "render": {
    "mode": "preview",
    "cropPlan": { "assetId": "asset123" },
    "timelineMap": { "assetId": "asset456" },
    "previewFrameCount": 6
  }
}
```

- `timelineMap` omitted ⇒ canonical render (plan times used directly).
- `render.mode` ∈ `"preview" | "full"`. Preview renders up to
  `CROP_WORKER_PREVIEW_MAX_SEGMENTS` (default 6) segments evenly sampled
  across the plan, capped at `CROP_WORKER_PREVIEW_MAX_SECONDS` (default 90).
- Response: `{ "workerJobId": "wj_...", "status": "queued" | "running" }` —
  submissions are idempotent for ACTIVE jobs: an existing queued/running job
  with the same logical identity (kind + assetId, plus render mode) is
  returned instead of enqueuing a duplicate (manager restarts/retries
  re-attach rather than doubling multi-hour ffmpeg load). Completed/failed
  records do not dedupe.
- 409 `{ "error": "queue_full" }` when the bounded queue is full; manager
  waits 30s and resubmits (bounded, 10 attempts) before failing the step.
- Source URLs are restricted by an ffmpeg `-protocol_whitelist`
  (production default `https,tls,tcp,crypto,hls`; `file` added outside
  production for local smokes) and a production-only https schema check.
- Each job runs under a total deadline strictly below manager's poll ceiling
  (fingerprint/preview 25min vs 30min; full render 5.5h vs 6h).

### `GET /jobs/{workerJobId}`

```json
{
  "workerJobId": "wj_...",
  "kind": "render",
  "status": "running",
  "progress": 0.42,
  "message": "Rendering segment 42 of 100",
  "error": null,
  "result": null
}
```

- `status` ∈ `"queued" | "running" | "completed" | "failed"`.
- On completion `result` carries `{ "artifacts": [{ "assetId", "artifactType", "ext" }], "report": <render report or fingerprint summary> }`.
- Worker state is in-memory; unknown id → 404. Manager treats 404 as lost and
  resubmits (bounded).

## Mastra service routes (exact)

All POST, bearer-validated against `MASTRA_SERVICE_API_KEYS`, response
envelope `{ "result": <discriminated union> }`. Failure shape:
`{ "ok": false, "reason": <enum>, "retryable": boolean, "message": string, "mastraRunId": string }`.
Shared failure reasons: `invalid_input | provider_config_missing | provider_auth_failed | provider_failed | provider_invalid_output | frame_host_not_allowed`.

### `POST /forge-smart-crop-plan`

```json
{
  "asset": { "assetId": "asset123", "playbackId": "pb_abc" },
  "source": { "width": 1920, "height": 1080, "durationSeconds": 7200 },
  "target": { "aspectRatio": "9:16", "width": 1080, "height": 1920 },
  "cropMode": "auto",
  "shots": [
    {
      "shotId": "shot_00421",
      "start": 124.2,
      "end": 139.8,
      "frameUrls": ["https://image.mux.com/..."]
    }
  ],
  "model": "qwen/qwen2.5-vl-72b-instruct"
}
```

- ≤ 8 shots per call (manager chunks); ≤ 3 frameUrls per shot.
- Frame URLs must be https and host-allowlisted
  (`SMART_CROP_IMAGE_URL_ALLOWED_HOSTS`, default `image.mux.com`).
- Success: `{ "ok": true, "segments": [<plan segment>], "usage": { "inputTokens", "outputTokens" }, "model": "..." }`
  — segment shape identical to the canonical plan `segments[]` entries.
- Vision LLM returns per-shot intent (mode, subjects, normalized subject
  center start/end, confidence); the deterministic planner
  (`smart-crop-planner-v1`) converts intent → cropKeyframes with: dead-zone
  8%, max pan 240 px/s (scaled by source width / 1920), prefer-wider-on-low
  confidence (center fallback below 0.5), clamping to crop bounds.

### `POST /forge-smart-crop-align`

```json
{
  "canonicalFingerprint": { "...": "smart-crop-fingerprint artifact JSON" },
  "localizedFingerprint": { "...": "..." },
  "language": "uk",
  "planShotIds": ["shot_00421"],
  "gates": { "minOverallConfidence": 0.92 }
}
```

- Success: `{ "ok": true, "timelineMap": { mappingMethod, overallConfidence, unmappedDurationPercent, maxConsecutiveUnmappedSeconds, segments, gate, warnings } }`
  (manager wraps it into artifact form with ids/version/kind).
- Tier 1: durations within 0.5% and equal shot counts → identical-duration map.
- Tier 2: monotonic shot-sequence alignment scored by duration similarity +
  dhash Hamming distance (best-path dynamic programming); per-shot confidence
  from combined score; unmatched plan shots counted as unmapped duration.

### `POST /forge-smart-crop-qa`

```json
{
  "asset": { "assetId": "asset123" },
  "renderMode": "preview",
  "planSummary": {
    "segmentCount": 412,
    "modes": { "speaker": 250, "group": 100 }
  },
  "frames": [
    {
      "atSeconds": 4,
      "url": "https://<presigned-or-mux-url>",
      "shotId": "shot_00421"
    }
  ],
  "model": "google/gemini-2.5-flash"
}
```

- Success: `{ "ok": true, "verdict": "pass", "issues": [...], "usage": {...}, "model": "..." }`.
- `frames[].shotId` is optional context for shot-scoped QA issues.
- ≤ 8 frames per call. Same https/host allowlist as plan route (S3 endpoint
  host must be added to the allowlist in production).

## Manager surface

### Durable workflows (`src/workflows/`)

- `runSmartCropCanonical` — steps: `smart_crop_fingerprint` →
  `smart_crop_plan` → `smart_crop_preview_render` → `smart_crop_qa`.
- `runSmartCropLocalized` — steps: `smart_crop_fingerprint` →
  `smart_crop_align` → `smart_crop_preview_render` → `smart_crop_qa` →
  `smart_crop_render` → `smart_crop_mux_output`.
- Steps idempotent: each checks `artifactExists` (and `force` option) before
  recomputing — skip paths parse and validate the existing artifact and
  recompute when malformed or provenance-stale. The Mux output step records
  the created asset in `smart-crop-mux-output-v1.json` before readiness
  polling and resumes that asset on retry (no duplicates). Deterministic
  failures (gate failure, plan not approved, dimension mismatch, malformed
  artifacts, non-retryable mastra reasons) throw the workflow SDK's
  `FatalError` so they are never step-retried; only transient errors use SDK
  retries.
- New `WorkflowStepName` members (manager-side unions + zod enum + step
  descriptions): `smart_crop_fingerprint`, `smart_crop_plan`,
  `smart_crop_align`, `smart_crop_preview_render`, `smart_crop_qa`,
  `smart_crop_render`, `smart_crop_mux_output`.

### Job options discriminator

`options.smartCrop = { kind: "canonical" | "localized", assetId, targetAspectRatio: "9:16", cropMode, canonicalAssetId?, language?, model?, force? }`
(JobOptions extended manager-side; admin stores as JSON).

A `smartCrop` **metadata artifact entry** mirrors live phase data for the UI:
`{ kind: "metadata", data: { domain: "smart_crop", kind, phase, alignment?: { overallConfidence, unmappedDurationPercent, gatePassed }, qa?: { verdict }, plan?: { segmentCount, approved }, output?: { muxAssetId, playbackId }, usage?: { inputTokens, outputTokens } } }`.

### API routes

- `POST /api/smart-crop/jobs` — body
  `{ kind, assetId?, muxAssetId, language?, canonicalAssetId?, cropMode?, model?, force? }`;
  validates, resolves playbackId via `getMuxAsset`, for localized requires
  canonical plan artifact to exist; creates JobRecord (smart-crop initial
  steps) and launches the durable workflow. 503 `config_missing` when
  crop-worker/mastra env unset.
- `GET /api/smart-crop/jobs` — list smart-crop jobs (listJobs + filter by
  `options.smartCrop`).
- `POST /api/smart-crop/jobs/{id}/approve` — `{ "action": "approve" | "reject" }`
  → updates plan artifact `qa` block + job metadata.
- `POST /api/smart-crop/jobs/{id}/retry` — relaunches the workflow for failed
  jobs (idempotent steps skip completed work). Accepts an optional lenient
  `{ "force": true }` body to regenerate artifacts — the operator escape
  hatch for stored QA `fail` verdicts and gate failures. Guarded against
  double-submits (30s in-flight TTL → 409).
- Artifact downloads reuse `/api/jobs/{id}/artifacts/{logicalKey}`:
  `job-artifacts.ts` gains `mp4`/`jpg` exts + smart-crop logical keys.

### Services

- `src/services/crop-worker.ts` — submit/poll client (discriminated envelope,
  `AbortSignal.timeout` 15s, poll interval 5s, per-mode ceilings:
  fingerprint 30min, preview 30min, full 6h; configurable).
- `src/services/mastra-smart-crop.ts` — three launchers mirroring
  `mastra-transcript-embeddings.ts` (120s timeout default each call).
- `src/services/storage.ts` — add `createPresignedArtifactUrl(...)`
  (S3 mode only; returns null in local fallback → QA/Mux steps degrade to
  skipped with reason).
- Mux output: `createMuxAsset({ inputUrl: presignedUrl, passthrough: jobId })`
  then poll `getMuxAsset` until ready (bounded 60min), with the asset id
  durably recorded before polling (see artifact 3b).

### UI

- Nav tab "Smart Crop" → `/dashboard/smart-crop`: create-canonical and
  create-localized forms + smart-crop jobs table (live via existing SSE
  controller).
- `/dashboard/smart-crop/[id]`: steps table (existing components), smart-crop
  card (phase, plan summary, alignment confidence + unmapped %, QA verdict,
  output playback id, approve/reject/retry buttons, artifact links).

## Env vars (all `.optional()` at schema load)

| App         | Var                                                                                                                               | Purpose                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| manager     | `CROP_WORKER_BASE_URL`                                                                                                            | crop-worker base URL                                                       |
| manager     | `CROP_WORKER_API_KEY`                                                                                                             | caller-side single bearer for crop-worker                                  |
| manager     | `MASTRA_SMART_CROP_TIMEOUT_MS`                                                                                                    | per-call mastra timeout (default 120000)                                   |
| mastra      | `SMART_CROP_PLAN_MODEL`                                                                                                           | default `qwen/qwen2.5-vl-72b-instruct`                                     |
| mastra      | `SMART_CROP_QA_MODEL`                                                                                                             | default `google/gemini-2.5-flash`                                          |
| mastra      | `SMART_CROP_IMAGE_URL_ALLOWED_HOSTS`                                                                                              | CSV, default `image.mux.com`                                               |
| crop-worker | `PORT`                                                                                                                            | default 3011                                                               |
| crop-worker | `CROP_WORKER_API_KEYS`                                                                                                            | receiver-side CSV allowlist                                                |
| crop-worker | `RAILWAY_S3_*`                                                                                                                    | same five names as manager; `.tmp/artifacts` fallback                      |
| crop-worker | `CROP_WORKER_MAX_CONCURRENT_JOBS`                                                                                                 | default 1                                                                  |
| crop-worker | `CROP_WORKER_PREVIEW_MAX_SEGMENTS` / `CROP_WORKER_PREVIEW_MAX_SECONDS`                                                            | preview sampling caps                                                      |
| crop-worker | `CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS` / `CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS`                                              | per-invocation ceilings (30min / 6h)                                       |
| crop-worker | `CROP_WORKER_FINGERPRINT_JOB_TIMEOUT_MS` / `CROP_WORKER_RENDER_PREVIEW_JOB_TIMEOUT_MS` / `CROP_WORKER_RENDER_FULL_JOB_TIMEOUT_MS` | per-JOB deadlines (25min/25min/5.5h), strictly below manager poll ceilings |
| crop-worker | `CROP_WORKER_SOURCE_PROTOCOL_WHITELIST`                                                                                           | ffmpeg protocol allowlist override (CSV)                                   |
| manager     | `CROP_WORKER_QUEUE_FULL_RETRY_INTERVAL_MS` / `CROP_WORKER_MAX_QUEUE_FULL_RETRIES`                                                 | queue_full wait-and-resubmit tuning (30s × 10)                             |

Deploy ordering (receiver first): set `CROP_WORKER_API_KEYS` on crop-worker,
verify 401-not-503 with wrong bearer, then set manager's `CROP_WORKER_*`.
Mastra needs no new bearer (existing `MASTRA_SERVICE_API_KEYS` pair).

## Implementation units

- **U1** Roadmap ticket feat-173 (media-generation, owner vlad) + this plan.
- **U2** apps/crop-worker scaffold + fingerprint op (ffprobe, scdet shot
  detection, 1fps dhash pass, fingerprint artifact) + render op (segment
  remap via timeline map, crop x-interpolation filtergraph per segment,
  concat, preview frames, render report, S3 upload) + bounded queue + tests
  (injectable runCommand per audioCleanup precedent) + railway.toml.
- **U3** apps/mastra: `smart-crop-plan`, `smart-crop-align`, `smart-crop-qa`
  workflows + `/forge-smart-crop-*` routes + env + tests (planner and
  alignment are pure functions — property-style unit tests; LLM calls via
  injectable fetchImpl).
- **U4** apps/manager backend: types/steps/env, crop-worker + mastra clients,
  storage presign, durable workflows + launchers, API routes, job-artifacts
  registry, tests.
- **U5** apps/manager UI: smart-crop pages + nav + cards.
- **U6** Docs: apps/crop-worker/CLAUDE.md, manager/mastra CLAUDE.md updates,
  roadmap status, this plan finalized. Tier-2 review before push.

## Verification

- `pnpm --filter @forge/crop-worker test|lint|typecheck|build`
- `pnpm --filter @forge/mastra test|lint|typecheck`
- `pnpm --filter @forge/manager test|lint|typecheck|build`
- Local smoke: `MANAGER_DATA_MODE=mock pnpm --filter @forge/manager dev` +
  `pnpm --filter @forge/crop-worker dev` + mastra dev with memory storage;
  create a canonical job against a public Mux playback id; confirm
  fingerprint/plan/preview artifacts under `.tmp/artifacts/{assetId}/`;
  approve; create localized job; confirm timeline map + gates + render.
