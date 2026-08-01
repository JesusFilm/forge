# apps/shorts-worker — Shorts Studio Remotion render worker

## What this app does

Plain `node:http` service that owns the byte work for Shorts Studio
(feat-178, 9:16 vertical shorts with word-level captions):

- **Prepare**: validates the source URL against an exact-host allowlist,
  ffmpeg input-seek trims the HLS source to a local clip MP4 (constant
  30fps), ffprobes it, and — when the clip has audio and a supported
  language — extracts a 16kHz WAV and runs whisper.cpp `large-v3-turbo`
  with token-level timestamps + a structural hallucination filter. Writes
  the clip, clip-meta, and captions artifacts.
- **Render**: downloads the clip artifact to tmp, serves it via a loopback
  single-file server, runs Remotion `selectComposition` + `renderMedia`
  over the baked composition bundle (1080x1920 H.264), ffprobe-sanity-checks
  the output, and writes the output MP4 + render-meta artifacts.

The authoritative wire contracts (request/response bodies, artifact JSON
shapes, literal kinds/statuses) live in
`docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md`. apps/manager
submits and polls jobs (`src/services/shorts-worker.ts` +
`src/workflows/shortsStudio.ts`); `packages/shorts-compositions` supplies
the composition, props schema (`/schema`), and the worker bundle entry
(`/entry`). Do not rename contract literals without updating the plan and
the manager client.

## Stack

- Node 22+ (>= 22.18 REQUIRED in the image — see Docker notes), TypeScript
  strict, NodeNext ESM (`.js` extensions on relative imports), plain
  `node:http` (no framework)
- zod 4 for env + request/artifact validation
- `@remotion/renderer` + `@remotion/bundler` (lazy dynamic imports inside
  the injectable `RenderEngine` — unit tests never load Chromium-adjacent
  code), `@remotion/install-whisper-cpp` for transcription
- `@aws-sdk/client-s3` (lazy import) for Railway S3 artifact storage
- vitest with colocated `*.test.ts`; all ffmpeg/S3/Remotion access behind
  injectable deps (`RunCommand`, `Storage`, `RenderEngine`, `TranscribeClip`)

## Folder structure

```
src/
  config/env.ts    Validated env (zod, emptyToUndefined, assertRuntimeEnv —
                   production also asserts model/whisper/bundle paths EXIST)
  server.ts        createHandleRequest DI factory + self-start (not in test)
  routes/jobs.ts   POST /jobs + GET/DELETE /jobs/{workerJobId} (zod schemas,
                   pre-enqueue SSRF gate, dedupe keys, enqueue-time deadline)
  routes/devotional-artifacts.ts  Bounded input PUT + output streaming GET
  auth.ts          CSV bearer allowlist (timing-safe full-list compare)
  jobs.ts          In-memory registry + TWO bounded lanes + in-flight dedupe
  deadline.ts      Per-job deadline (enqueue-time budget, caps invocations)
  source-url.ts    SSRF enforcement (exact-host allowlist, https-only-in-prod)
  prepare.ts       Trim + probe + whisper pipeline + prepare artifacts
  render.ts        Baked-bundle Remotion render + output sanity + artifacts
  devotional-render.ts  Arclight lookup/download + ffmpeg prep + one-bundle
                   portrait/wide render + durable outputs
  clip-server.ts   Loopback single-file static server for renders
  whisper.ts       @remotion/install-whisper-cpp wrapper + hallucination filter
  ffmpeg.ts        RunCommand (spawn) + probeMedia + protocol whitelist
  storage.ts       S3-or-local artifact storage ({assetId}/{artifactType}.{ext})
  http.ts          sendJson + readJsonBody (1MB cap, content-type checked)
  errors.ts        WorkerError → JobErrorBody (reason, messages, retryable)
  types.ts         Contract types (artifact shapes, job status body)
scripts/
  prebundle.ts     Bakes the Remotion bundle (Docker build step)
  smoke.ts         Host smoke (lavfi source → prepare → render → ffprobe)
```

## API summary

Auth: `Authorization: Bearer <key>` against the `SHORTS_WORKER_API_KEYS`
CSV. Timing-safe comparison across the full allowlist (no short-circuit). In
production an unset allowlist returns 503 `{"error":"config_missing"}`;
outside production an unset allowlist bypasses auth (local dev). Bad/missing
bearer → 401 `{"error":"unauthorized"}`.

- `GET /health` (unauthenticated) → `{ "ok": true, "service": "shorts-worker" }`
- `POST /jobs` → 202 `{ "workerJobId": "wj_...", "status": "queued" | "running" }`;
  400 `invalid_body` (including SSRF-rejected source URLs), 409 `queue_full`,
  413 `body_too_large`. Body is the discriminated
  `kind: "prepare" | "render" | "devotional-render"` shape:
  - **prepare**: `{ kind, jobId?, assetId, source: { url }, clip: { startSec,
endSec }, transcription: { language: string | null } }`. `language` is
    the whisper ISO-639-1 code resolved by manager (`null` = unsupported →
    captions-less degradation, same path as no-audio).
  - **render**: `{ kind, jobId?, assetId, propsHash, draftVersion, props }`
    where `props` is `shortInputPropsSchema.omit({ clipUrl: true })` from
    `@forge/shorts-compositions/schema` — the worker injects the loopback
    `clipUrl` at compose time; `propsHash` is the manager-computed sha256
    treated as an OPAQUE token (shape-checked, never recomputed).
  - **devotional-render**: `{ kind, jobId?, runId, inputAssetId,
outputAssetId, inputHash }`. The worker owns Arclight lookup/download,
    ffmpeg preparation, and one-bundle portrait + wide rendering.
- `GET /jobs/{workerJobId}` → snapshot
  `{ workerJobId, kind, status: queued|running|completed|failed|cancelled, progress
0..1, message, error, result }`. `error` is structured
  `{ reason, messages, retryable }` — manager maps `retryable:false` to a
  workflow `FatalError`. On completion `result` = `{ artifacts: [{ assetId,
artifactType, ext }], report }` (prepare report: `{ hasAudio,
clipDurationSec, captionsCount, annotation }`; render report:
  `{ outputDurationSec, width, height }`). 404 `not_found` for unknown ids.
- `DELETE /jobs/{workerJobId}` cancels devotional jobs and returns 202.
- `PUT /devotional-inputs/{inputAssetId}/{artifactType}.{ext}` accepts only
  the fixed devotional JSON/narration/music types and enforces auth, content
  type, schema validation, and per-type body caps.
- `GET /artifacts/{outputAssetId}/{artifactType}.mp4` streams only the
  authenticated portrait/wide devotional output types. Input and metadata
  artifacts are never exposed by this route. Single-byte ranges return 206
  with `Content-Range`; invalid ranges return 416.

## Lanes, queue, dedupe

- **Two independent lanes** (prepare, render), 1 concurrent job each, queue
  limit 2 per lane (pending + running; `SHORTS_WORKER_QUEUE_LIMIT`). Beyond
  the limit → 409 `queue_full` (manager waits 30s and resubmits, bounded).
  The registry is shared (GET doesn't know the kind); capacity is per-lane
  so a 20-minute render never starves prepares.
- Devotional renders share the existing render lane, preventing concurrent
  Shorts + devotional Chromium workloads from oversubscribing the worker.
- **In-flight dedupe keys:** `prepare:{assetId}` and
  `render:{assetId}:{propsHash}`; devotional uses
  `devotional-render:{outputAssetId}:{inputHash}` — deliberately NOT the
  manager `jobId`. A
  re-launched manager workflow, SDK step retry, or operator retry for the
  same logical work then RE-ATTACHES to the running job (202 with the
  existing `workerJobId`, `event=job_deduped`) instead of double-rendering.
  Completed/failed records never dedupe (manager resubmits after failure
  intentionally). The manager client mirrors the same keys pre-submit
  (`shortsWorkerDedupeKey` — root CLAUDE.md: client mirrors server dedupe).
- **In-memory state caveat:** registry and lanes are process-local. A
  restart loses everything; manager treats a 404 poll as `job_lost` and
  resubmits (bounded, 2 resubmits). **Single replica only** — see
  railway.toml notes below.
- **Terminal record eviction:** every `submit` first prunes completed/failed
  records older than 24h (`TERMINAL_RECORD_RETENTION_MS` in `jobs.ts`;
  a terminal record's `updatedAt` is its finish time) so the registry can't
  grow unboundedly over the process lifetime. Active (queued/running) jobs
  are never evicted regardless of age. 24h is orders of magnitude beyond
  manager's longest poll ceiling (80min render), so an outcome is always
  still readable when manager polls for it.
- The job runner wraps the ENTIRE async body in try/catch/finally
  (fire-and-forget slot-leak guard — root CLAUDE.md Known Patterns).

## Deadline chain

Per-job deadlines are created at ENQUEUE time (manager's poll budget accrues
from submission, so queue wait counts) and sized to cover one queued
predecessor plus the job's own budget. Every subprocess invocation and every
Remotion engine call is capped at the remaining budget; once exhausted the
job fails fast with a typed `JobDeadlineExceededError` so manager gets a
definitive `failed` instead of burning its poll ceiling.

| Stage                    | Worker budget        | Manager poll ceiling | Rule                                        |
| ------------------------ | -------------------- | -------------------- | ------------------------------------------- |
| prepare job              | 45min (enqueue-time) | 50min                | worker strictly below manager               |
| render job               | 70min (enqueue-time) | 80min                | worker strictly below manager               |
| ffmpeg invocation        | 30min cap            | —                    | additionally capped at remaining job budget |
| whisper invocation       | 30min cap            | —                    | additionally capped at remaining job budget |
| Remotion per-delayRender | 120s (fixed)         | —                    | per-frame readiness, NOT the job ceiling    |

Raise a worker/manager pair TOGETHER, worker strictly below manager (root
CLAUDE.md: outbound timeout shorter than caller budget). On a dedupe hit the
fresh deadline is discarded — the running job keeps the deadline from its
own enqueue.

## SSRF invariants (source-url.ts)

`validateSourceUrl` runs at the ROUTE (pre-enqueue, 400 before burning a
lane slot) AND again inside `runPrepare` before any ffmpeg/ffprobe spawn
(defense in depth):

- Re-parse with `new URL`; require `https:` AND an EXACT hostname match
  against `SHORTS_WORKER_ALLOWED_SOURCE_HOSTS` (default `stream.mux.com`).
  Case-insensitive, never `endsWith` — suffix spoofs like
  `stream.mux.com.evil.com` must fail (rejection unit tests cover suffix
  spoof, loopback, link-local 169.254.169.254, and `file:`/`data:` smuggles).
- **The S3 endpoint host is deliberately NOT allowlisted** — artifacts move
  via the AWS SDK, never through ffmpeg, so ffmpeg has no business reaching
  the bucket and a leaked presigned URL can't be replayed through the worker.
- Non-production carve-out: `http://127.0.0.1` is allowed ONLY when
  `127.0.0.1` is explicitly in the allowlist — this is how the host smoke
  serves its synthetic source. Production rejects all non-https schemes.
- Every ffmpeg/ffprobe invocation that reads the request-supplied URL passes
  `-protocol_whitelist https,tls,tcp,crypto,hls` (plus `http` only on the
  validated loopback smoke path), and receives the RE-SERIALIZED parsed URL
  (`validated.url.toString()`) — exactly the string that passed validation,
  never the raw caller-supplied bytes. Worker-generated local temp files keep
  ffmpeg's default protocol set — do NOT add the restrictive whitelist there.
- **No protocol-whitelist env knob — deliberate.** crop-worker exposes
  `CROP_WORKER_SOURCE_PROTOCOL_WHITELIST` as a CSV override; shorts-worker
  intentionally DROPS that knob. The whitelist is derived in code only
  (`sourceProtocolWhitelist()` in `ffmpeg.ts`, keyed off the validated
  loopback flag), so loosening the SSRF posture requires a code change and
  review — not a quiet env edit on the Railway dashboard. Do not add the
  env var back.
- The render's loopback clip server binds `127.0.0.1` explicitly on an
  ephemeral port, serves EXACTLY `GET/HEAD /clip.mp4` (404s everything
  else), and is torn down in `finally`. `Access-Control-Allow-Origin: *` is
  safe given the loopback bind (needed by `useWindowedAudioData`).

## Artifacts

Key scheme `{assetId}/{artifactType}.{ext}` (validated, flat). `assetId` is
the per-short prefix minted by manager (`{muxAssetId}-short-{suffix}`).

| Artifact                            | Written by        | Contents                                                               |
| ----------------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `shorts-clip-v1.mp4`                | prepare           | trimmed 30fps clip (libx264 veryfast CRF 17 intermediate, +faststart)  |
| `shorts-clip-meta-v1.json`          | prepare           | HOST-ONLY source provenance, bounds, duration/fps/dimensions, hasAudio |
| `shorts-captions-v1.json`           | prepare           | whisper word captions + language + model + annotation + generatedAt    |
| `shorts-output-v1.mp4`              | render            | 1080x1920 H.264 rendered short (ffprobe-verified, duration ±0.5s)      |
| `shorts-render-meta-v1.json`        | render            | propsHash (echoed verbatim), renderedDraftVersion, compositionsVersion |
| `devotional-render-input-v1.json`   | upload            | Content, media id/window, segments, and render options                 |
| `devotional-narration-{id}-v1.mp3`  | upload            | One bounded narration segment                                          |
| `devotional-music-v1.mp3`           | upload            | Optional bounded music bed                                             |
| `devotional-output-portrait-v1.mp4` | devotional-render | 1080x1920 H.264 output                                                 |
| `devotional-output-wide-v1.mp4`     | devotional-render | 1920x1080 H.264 output                                                 |
| `devotional-render-meta-v1.json`    | devotional-render | Input provenance and both output refs/metadata                         |

Reads: render reads `shorts-clip-v1.mp4`. Manager-owned artifacts under the
same prefix (`shorts-draft-v1.json`, `shorts-render-props-v1.json`,
`shorts-mux-output-v1.json`) are never touched by the worker. Provenance
note: clip-meta carries the source HOSTNAME only — full URLs (presigned or
otherwise) are never persisted. Orphaned artifacts from abandoned drafts are
an accepted v1 cost (no GC).

## Environment variables

All optional at schema load (opt-in scaffolding rule); `assertRuntimeEnv()`
throws at startup in production when the required set is missing — and ALSO
when `SHORTS_WORKER_BUNDLE_DIR` / `SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR` /
`SHORTS_WORKER_WHISPER_MODEL_PATH` / `SHORTS_WORKER_WHISPER_CPP_DIR` point at
paths that don't exist (fail-fast on a broken image).

| Variable                                  | Default                   | Notes                                                                                                                         |
| ----------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| PORT                                      | 3012                      |                                                                                                                               |
| NODE_ENV                                  | development               | `test` suppresses self-start                                                                                                  |
| SHORTS_WORKER_API_KEYS                    | —                         | CSV allowlist; required in production; DISTINCT secret from CROP_WORKER_API_KEYS                                              |
| RAILWAY_S3_ENDPOINT                       | —                         | required in production                                                                                                        |
| RAILWAY_S3_REGION                         | —                         | required in production                                                                                                        |
| RAILWAY_S3_BUCKET                         | —                         | presence toggles S3 mode; req. in prod                                                                                        |
| RAILWAY_S3_ACCESS_KEY_ID                  | —                         | required in production                                                                                                        |
| RAILWAY_S3_SECRET_ACCESS_KEY              | —                         | required in production                                                                                                        |
| DEVOTIONAL_WORKSPACE_S3_ENDPOINT          | —                         | dedicated devotional Workspace endpoint; complete tuple required for v2 devotional artifacts in production                    |
| DEVOTIONAL_WORKSPACE_S3_REGION            | —                         | dedicated devotional Workspace region                                                                                         |
| DEVOTIONAL_WORKSPACE_S3_BUCKET            | —                         | dedicated devotional Workspace bucket; must match Mastra                                                                      |
| DEVOTIONAL_WORKSPACE_S3_ACCESS_KEY_ID     | —                         | dedicated devotional Workspace access key reference                                                                           |
| DEVOTIONAL_WORKSPACE_S3_SECRET_ACCESS_KEY | —                         | dedicated devotional Workspace secret reference                                                                               |
| DEVOTIONAL_WORKSPACE_PREFIX               | devotional                | shared key prefix inside the dedicated bucket; must match Mastra                                                              |
| DEVOTIONAL_WORKSPACE_LOCAL_DIR            | .tmp/devotional-workspace | contained dev/test fallback when the entire dedicated S3 tuple is absent                                                      |
| SHORTS_WORKER_LOCAL_ARTIFACTS_DIR         | .tmp/artifacts            | local fallback root (point at manager's `.tmp/artifacts` for parity)                                                          |
| SHORTS_WORKER_ALLOWED_SOURCE_HOSTS        | stream.mux.com            | exact-host CSV; S3 host deliberately excluded (see SSRF invariants)                                                           |
| SHORTS_WORKER_RENDER_CONCURRENCY          | 2                         | Remotion renderMedia concurrency (2 on 4 vCPU — x264 needs the rest)                                                          |
| SHORTS_WORKER_BUNDLE_DIR                  | —                         | baked bundle dir (`/app/bundle` in Docker); required + must exist in prod; absent → runtime-memoized `bundle()` for local dev |
| SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR       | —                         | baked devotional bundle (`/app/devotional-bundle`); required + must exist in prod; copied per job to stage media              |
| SHORTS_WORKER_WHISPER_MODEL_PATH          | —                         | required + must exist in prod; unset locally → captions-less degradation                                                      |
| SHORTS_WORKER_WHISPER_CPP_DIR             | —                         | whisper.cpp install dir; required + must exist in prod                                                                        |
| SHORTS_WORKER_WHISPER_CPP_VERSION         | 1.7.4                     | SEMVER string (raw commit SHAs break install-whisper-cpp's compareVersions); keep in sync with the Dockerfile pins            |
| SHORTS_WORKER_QUEUE_LIMIT                 | 2                         | per-LANE cap (pending + running) → 409 `queue_full`                                                                           |
| SHORTS_WORKER_PREPARE_JOB_TIMEOUT_MS      | 2700000                   | 45min per-JOB budget; < manager's 50min prepare poll ceiling                                                                  |
| SHORTS_WORKER_RENDER_JOB_TIMEOUT_MS       | 4200000                   | 70min per-JOB budget; schema-capped at 4740000ms, leaving 60s below Mastra's 80min devotional poll ceiling                    |
| SHORTS_WORKER_FFMPEG_TIMEOUT_MS           | 1800000                   | 30min per-invocation cap                                                                                                      |
| SHORTS_WORKER_WHISPER_TIMEOUT_MS          | 1800000                   | 30min per-invocation cap                                                                                                      |

## Docker build

First Dockerfile-built app in the worker fleet (crop-worker is NIXPACKS).
Build context MUST be the repo root:
`docker build -f apps/shorts-worker/Dockerfile -t shorts-worker .`
(BuildKit reads `apps/shorts-worker/Dockerfile.dockerignore`.)

Five stages on `node:22-bookworm-slim` **pinned by digest**
(`sha256:e21fc383...`):

1. **runtime-base** — apt: Chromium runtime libs + `fonts-noto-color-emoji
fonts-noto-cjk` (fallback glyphs only; brand fonts are vendored in the
   compositions package) + ffmpeg.
2. **media-deps** — standalone npm project (NOT the workspace, so these
   layers are invalidated only by pins in the Dockerfile): compiles
   whisper.cpp 1.7.4 **hard-verified against commit
   `8a9ad7844d6e2a10cddf4b92de4089d7ac2b14a9`** (a moved tag fails the
   build); downloads `ggml-large-v3-turbo` and **SHA-256-verifies it against
   the pinned `WHISPER_MODEL_SHA256` ARG constant** (build fails on
   mismatch). The expected hash is a LITERAL baked into the Dockerfile —
   never fetched at build time from the HuggingFace LFS pointer, which lives
   on the same mutable `main` ref as the model bytes (an upstream re-push
   would rotate both together). Rotate the ARG deliberately on an
   intentional model upgrade, same posture as `WHISPER_CPP_COMMIT_SHA`.
   Finally downloads chrome-headless-shell via `ensureBrowser()` (pinned
   transitively by the exact `@remotion/renderer` version).
3. **build** — pnpm workspace install + `tsc` + `prebundle` (Remotion
   `bundle()` over `@forge/shorts-compositions/entry` → `/app/bundle`).
   Webpack never runs at runtime; the first render after deploy costs the
   same as the Nth. COPYies root `patches/` before `pnpm install` — pnpm
   hashes every root `pnpm.patchedDependencies` file even when the patched
   package is outside the `--filter`, so a missing patch ENOENTs the
   install.
4. **prod-deps** — production-only `pnpm install` PRESERVING the workspace
   symlink layout (also COPYies `patches/`, same pnpm requirement as the
   build stage). **Deliberately NOT `pnpm deploy`:** deploy materializes
   the source-shipped TS compositions package UNDER `node_modules`, where
   Node refuses type-stripping. The workspace symlink (realpath
   `/app/packages/shorts-compositions`, outside `node_modules`) is what
   makes the TS schema importable from compiled dist — which is why
   **Node >= 22.18 type stripping is a HARD runtime requirement**.
5. **runtime** — stable layers first (node_modules, whisper, model, browser
   cache copied to `/app/apps/shorts-worker/node_modules/.remotion`),
   volatile app layers last (compositions source, dist, bundle). Sets
   `SHORTS_WORKER_BUNDLE_DIR=/app/bundle` + the whisper paths.

**Layer ordering rule:** apt/model/browser layers depend only on pins, never
app source — code-only deploys push/pull small layers, not the ~1.6GB model.
Keep it that way.

## Deploy checklist (Railway)

1. Create the service from this repo; builder DOCKERFILE,
   `dockerfilePath = apps/shorts-worker/Dockerfile`. Set the dashboard
   **Config-as-code Path** to `apps/shorts-worker/railway.toml` — Railway
   silently ignores the file otherwise (silent-ignore precedent).
2. Verify Railway honors `apps/shorts-worker/Dockerfile.dockerignore` on the
   first deploy (first Dockerfile app in the fleet — unverified Railway
   behavior).
3. **numReplicas = 1, required:** lanes/registry/dedupe are in-memory. A
   second replica round-robins manager's status polls onto replicas that
   never saw the POST → spurious 404s → `job_lost` resubmit storms while
   orphaned renders burn CPU. Keep the dashboard replica setting at 1 too.
   Throughput scaling belongs to `SHORTS_WORKER_QUEUE_LIMIT`, not replicas.
4. Set `RAILWAY_S3_*` + `SHORTS_WORKER_API_KEYS`. The keyring MUST be a
   **distinct secret from `CROP_WORKER_API_KEYS`** — a shared value would
   make one worker's bearer authorize the other.
   Keep the object bucket private and its credentials Worker-only; never expose
   public or presigned object URLs in the lifecycle contract.
5. **Receiver first:** verify a wrong bearer returns 401 — NOT 503
   (`curl -H "Authorization: Bearer wrong" https://<worker>/jobs`). A 503
   means `SHORTS_WORKER_API_KEYS` isn't set. Only THEN set manager's
   `SHORTS_WORKER_BASE_URL` + `SHORTS_WORKER_API_KEY`. Reverse order
   produces a dead minute where manager's first call 401s.
   Also prove anonymous job submission, cancellation, devotional input upload,
   and artifact Range reads return 401, and anonymous bucket reads are denied.
6. Healthcheck `/health` with `healthcheckTimeout = 120` (railway.toml).
   120s is deliberately BELOW Railway's 300s default: boot does no heavy
   work (the Remotion bundle is pre-baked, the whisper model is loaded
   per-transcription, and `assertRuntimeEnv` only stats paths), so a healthy
   container answers `/health` within seconds of start — if it hasn't
   answered in 2 minutes the image is broken (missing model/bundle/whisper
   path throws at startup) and the deploy should fail fast instead of
   hanging for the full default window.

## Development

```bash
pnpm --filter @forge/shorts-worker dev        # tsx src/server.ts on :3012
pnpm --filter @forge/shorts-worker test       # vitest run
pnpm --filter @forge/shorts-worker typecheck
pnpm --filter @forge/shorts-worker lint
pnpm --filter @forge/shorts-worker build      # tsc -> dist/
pnpm --filter @forge/shorts-worker smoke      # host smoke (see below)
```

The host smoke (`scripts/smoke.ts`) generates a 20s lavfi synthetic source,
serves it over a loopback server (allowlisted `127.0.0.1`), runs the REAL
prepare and render pipelines (runtime `bundle()`, real Chromium via
`ensureBrowser`), and ffprobe-asserts the 1080x1920 output. **The whisper
model is optional locally:** without `SHORTS_WORKER_WHISPER_MODEL_PATH` the
smoke asserts the unsupported-language skip path instead of real captions.
Point `SHORTS_WORKER_LOCAL_ARTIFACTS_DIR` at `../manager/.tmp/artifacts` for
manager↔worker local parity.

## Known gaps

- **The container smoke has NOT yet been run** (here or in CI): `docker
build` + driving the image is the only proof that Chromium launches,
  vendored + fallback fonts resolve, the whisper model loads, and the baked
  bundle resolves IN-IMAGE. The host smoke passed (~31s, real prepare + real
  Chromium render verified by ffprobe), but it exercises the runtime-bundle
  path, not the baked image. Run the container smoke before the first
  production job; wiring it into CI is a recorded fast-follow on feat-178.
  **The container smoke must be HTTP-driven:** the runtime image ships only
  `dist/`, the baked bundle, and prod node_modules — `tsx` and `scripts/`
  are NOT in the image, so `scripts/smoke.ts` cannot execute inside the
  container. Drive it from the host instead: start the container, then
  POST /jobs and poll GET /jobs/{workerJobId} against the published port
  (serve the synthetic source to the container over a host-reachable URL
  added to `SHORTS_WORKER_ALLOWED_SOURCE_HOSTS`).

## Conventions

- Never read `process.env` outside `src/config/env.ts`.
- Request-path logs use the plain-string
  `[shorts-worker] event=name key=value` format (Railway logsV2 drops
  JSON.stringify payloads from Node runtimes — see root CLAUDE.md).
- Service results use discriminated unions / typed `WorkerError` subclasses
  (`SourceUrlRejectedError`, `ClipOutOfRangeError`, `OutputSanityError`,
  `JobDeadlineExceededError`, `WhisperUnavailableError`) that map to the
  structured `JobErrorBody` with an honest `retryable` flag — manager turns
  `retryable:false` into a workflow `FatalError`.
- `remotion`/`@remotion/*` versions are pinned EXACT and must stay in
  lockstep with `packages/shorts-compositions` and `apps/manager` — the
  version-lockstep test in the compositions package fails on drift.
- All Remotion imports stay inside lazy dynamic imports in
  `createDefaultRenderEngine`; per-job `openBrowser()` is closed in
  `finally` (no cross-job browser reuse).
