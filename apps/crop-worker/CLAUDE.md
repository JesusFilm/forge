# apps/crop-worker — Smart Crop FFmpeg worker

## What this app does

Plain `node:http` service that owns the ffprobe/FFmpeg byte work for Smart
Crop (9:16 vertical reframing):

- **Fingerprint**: probes the source, detects shot boundaries (scene filter +
  `showinfo`), runs a 1fps 9x8-grayscale dhash pass, and writes the
  `smart-crop-fingerprint-v1.json` artifact.
- **Render**: reads a canonical crop plan (and, for localized jobs, a timeline
  map), renders each segment with an animated horizontal crop + scale to
  1080x1920, concats, uploads the MP4, extracts preview frames for AI QA, and
  writes a render report artifact.

The authoritative wire contracts (artifact JSON shapes, HTTP bodies, literal
kinds/statuses) live in `docs/plans/2026-06-09-002-feat-smart-crop-plan.md`.
apps/manager submits and polls jobs; apps/mastra consumes fingerprint
artifacts for alignment. Do not rename contract literals without updating the
plan and both consumers.

## Stack

- Node 22+, TypeScript strict, NodeNext ESM (`.js` extensions on relative
  imports), plain `node:http` `createServer` (no framework)
- zod 4 for env + request/artifact validation
- `@aws-sdk/client-s3` (lazy import) for Railway S3 artifact storage
- vitest with colocated `*.test.ts`; all FFmpeg/S3 access behind injectable
  deps (`RunCommand`, `Storage`)

## Folder structure

```
src/
  config/env.ts   Validated env (zod, emptyToUndefined, assertRuntimeEnv)
  server.ts       createHandleRequest DI factory + self-start (not in test)
  routes/jobs.ts  POST /jobs + GET /jobs/{workerJobId}
  auth.ts         CSV bearer allowlist (timing-safe full-list compare)
  jobs.ts         In-memory job registry + bounded queue + in-flight dedupe
  deadline.ts     Per-job deadline (enqueue-time budget, caps invocations)
  fingerprint.ts  Shot detection + dhash pass + fingerprint artifact
  render.ts       Segment render + concat + frames + render report
  crop-plan.ts    Zod schemas for plan/timeline-map + remap + preview sampling
  ffmpeg.ts       RunCommand (spawn) + probeSource + ENOENT classification
  storage.ts      S3-or-local artifact storage ({assetId}/{artifactType}.{ext})
  http.ts         sendJson + readJsonBody (size-capped, content-type checked)
  types.ts        Contract types (artifact shapes, job status body)
```

## API summary

Auth: `Authorization: Bearer <key>` against the `CROP_WORKER_API_KEYS` CSV.
Timing-safe comparison across the full allowlist (no short-circuit). In
production an unset allowlist returns 503 `{"error":"config_missing"}`;
outside production an unset allowlist bypasses auth (local dev). Bad/missing
bearer → 401 `{"error":"unauthorized"}`.

- `GET /health` (unauthenticated) → `{ "ok": true, "service": "crop-worker" }`
- `POST /jobs` → 202 `{ "workerJobId": "wj_...", "status": "queued" | "running" }`;
  400 `invalid_body`, 409 `queue_full`, 413 `body_too_large`. Body is the
  discriminated `kind: "fingerprint" | "render"` shape from the plan doc. In
  production `source.url` must be a parseable https URL (400 otherwise).
  **In-flight dedupe:** when an ACTIVE (queued/running) job already exists
  with the same logical identity — `fingerprint:{assetId}` or
  `render:{assetId}:{mode}:{cropPlan.assetId}:{timelineMap.assetId ?? ""}`,
  deliberately NOT the manager `jobId` — the POST re-attaches: 202 with the
  EXISTING job's `workerJobId` and current status (`event=job_deduped`).
  Completed/failed records never dedupe (manager resubmits after failure
  intentionally). This turns manager restarts / SDK step retries / operator
  retries into re-attaches instead of duplicate multi-hour renders.
- `GET /jobs/{workerJobId}` → status JSON
  (`status` ∈ `queued | running | completed | failed`, `progress` 0..1,
  `message`, `error`, `result`); 404 `{"error":"not_found"}` for unknown ids.
  On completion `result` = `{ artifacts: [{ assetId, artifactType, ext }],
report }` where `report` is the render report (render jobs) or the
  fingerprint summary `{ shotCount, durationSeconds, width, height }`.

**In-memory job state caveat:** the registry and queue are process-local.
A restart loses all job records; manager treats a 404 poll as a lost job and
resubmits (bounded). Completed records are retained for the process lifetime
(small JSON; queue limit bounds growth per restart cycle). **Single replica
only:** scaling the Railway service to >1 replica round-robins manager's
status polls onto replicas that never saw the POST, producing spurious 404s
that manager classifies as `job_lost` (bounded resubmit, then terminal
failure) while orphaned renders keep burning CPU. `railway.toml` pins
`numReplicas = 1`; keep the dashboard replica setting at 1 too (the file only
applies when the service's Config-as-code Path is set). Throughput scaling
belongs to `CROP_WORKER_MAX_CONCURRENT_JOBS` / `CROP_WORKER_QUEUE_LIMIT`.

Render progress is reported as `segmentsDone/totalSegments * 0.9` with
message `"Rendering segment X of Y"`; upload + report occupy the final 0.1
(the record jumps to `progress: 1` on completion). `segmentsPlanned` in the
render report counts the segments selected for THIS render (post remap +
preview sampling); unmapped/zero-duration drops surface in `warnings`.

## Artifacts written

Key scheme `{assetId}/{artifactType}.{ext}` (validated, flat — see plan
deviation 3):

- `{assetId}/smart-crop-fingerprint-v1.json`
- `{assetId}/smart-crop-preview-9x16.mp4` (preview render)
- `{assetId}/smart-crop-output-9x16.mp4` (full render)
- `{assetId}/smart-crop-preview-frame-9x16-{NNN}.jpg` (NNN = 001..)
- `{assetId}/smart-crop-render-report-9x16-{preview|full}.json`

Reads: `{cropPlanAssetId}/smart-crop-plan-9x16-v1.json` and
`{timelineMapAssetId}/smart-crop-timeline-map-v1.json`.

## FFmpeg notes

- Railway uses the NIXPACKS builder; the repo-root `nixpacks.toml` adds
  `ffmpeg` (which includes `ffprobe`) to the setup phase. The service does NOT
  assume the binaries exist: a spawn ENOENT is classified into a
  `MissingBinaryError` ("ffmpeg/ffprobe is required for crop-worker...")
  instead of an opaque failure.
- Crop filter shape per segment:
  `crop=W:H:'X_EXPR':Y,scale=1080:1920:flags=lanczos,setsar=1`. The single
  quotes around the x expression are REQUIRED — `min(t/D,1)` contains a comma
  and an unquoted expression would split the filtergraph. x values are
  rounded to even integers (yuv420p chroma alignment). The `min(t/D,1)`
  full-span lerp fast path applies only to 2 keyframes at exactly progress
  0 and 1 (the expected case); any other keyframe set — including 2
  keyframes at other progress values — uses nested `if(lt(t,...))` piecewise
  lerp that honors the progress values.
- **Source protocol whitelist:** every ffmpeg/ffprobe invocation that reads
  the request-supplied `source.url` (probe, both fingerprint passes, render
  segments) passes `-protocol_whitelist` — `https,tls,tcp,crypto,hls` in
  production, plus `file` outside production (local-path smokes), overridable
  via `CROP_WORKER_SOURCE_PROTOCOL_WHITELIST`. Defense-in-depth against
  `file:`/`concat:`/`data:`/`http:` smuggling on top of the schema-level
  https check. The concat pass and preview-frame extraction read
  worker-generated local temp files and keep ffmpeg's default protocol set —
  do NOT add the restrictive whitelist there.
- **Per-JOB deadlines:** each job gets a deadline at ENQUEUE time (queue wait
  counts, matching how manager's poll budget accrues from submission):
  fingerprint 25min, preview render 25min, full render 5.5h by default
  (`CROP_WORKER_*_JOB_TIMEOUT_MS`), each strictly below manager's
  30min/30min/6h poll ceilings in `apps/manager/src/workflows/smartCrop.ts`
  (root CLAUDE.md: outbound timeout below caller budget — raise the pair
  together, worker strictly below manager). Before every invocation the
  per-invocation timeout is capped at the remaining budget; once the budget
  is exhausted the job fails fast with a typed `JobDeadlineExceededError`
  ("job deadline exceeded after Xs") so manager gets a definitive `failed`
  instead of burning its poll ceiling against a stuck slot.
- The dhash pass assumes frame N of the `fps=1` output corresponds to
  N + 0.5 seconds (approximately mid-second) — documented in
  `src/fingerprint.ts`.
- Per-invocation timeouts: fingerprint passes use
  `CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS` (default 30min), render passes
  use `CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS` (default 6h). Timeout kills the
  child with SIGKILL.
- Render outputs stream to S3 via `writeArtifactFromFile` (no multi-GB
  in-memory buffering); temp dirs (`mkdtemp`) are removed in `finally`.

## Environment variables

All optional at schema load (opt-in scaffolding rule); `assertRuntimeEnv()`
throws at startup in production when the required set is missing.

| Variable                                  | Default        | Notes                                                                      |
| ----------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| PORT                                      | 3011           |                                                                            |
| NODE_ENV                                  | development    | `test` suppresses self-start                                               |
| CROP_WORKER_API_KEYS                      | —              | CSV allowlist; required in production                                      |
| RAILWAY_S3_ENDPOINT                       | —              | required in production                                                     |
| RAILWAY_S3_REGION                         | —              | required in production                                                     |
| RAILWAY_S3_BUCKET                         | —              | presence toggles S3 mode; req. in prod                                     |
| RAILWAY_S3_ACCESS_KEY_ID                  | —              | required in production                                                     |
| RAILWAY_S3_SECRET_ACCESS_KEY              | —              | required in production                                                     |
| CROP_WORKER_LOCAL_ARTIFACTS_DIR           | .tmp/artifacts | local fallback root (point at manager's `.tmp/artifacts` for local parity) |
| CROP_WORKER_MAX_CONCURRENT_JOBS           | 1              | queue concurrency                                                          |
| CROP_WORKER_QUEUE_LIMIT                   | 10             | in-flight cap → 409 `queue_full`                                           |
| CROP_WORKER_PREVIEW_MAX_SEGMENTS          | 6              | preview sampling cap                                                       |
| CROP_WORKER_PREVIEW_MAX_SECONDS           | 90             | preview duration cap                                                       |
| CROP_WORKER_FFMPEG_FINGERPRINT_TIMEOUT_MS | 1800000        | 30min per-invocation cap                                                   |
| CROP_WORKER_FFMPEG_RENDER_TIMEOUT_MS      | 21600000       | 6h per-invocation cap                                                      |
| CROP_WORKER_FINGERPRINT_JOB_TIMEOUT_MS    | 1500000        | 25min per-JOB budget; < manager's 30min fingerprint poll ceiling           |
| CROP_WORKER_RENDER_PREVIEW_JOB_TIMEOUT_MS | 1500000        | 25min per-JOB budget; < manager's 30min preview poll ceiling               |
| CROP_WORKER_RENDER_FULL_JOB_TIMEOUT_MS    | 19800000       | 5.5h per-JOB budget; < manager's 6h full-render poll ceiling               |
| CROP_WORKER_SOURCE_PROTOCOL_WHITELIST     | —              | CSV override for the source-URL `-protocol_whitelist` (see FFmpeg notes)   |
| CROP_WORKER_SCENE_THRESHOLD               | 0.3            | scene-change sensitivity                                                   |
| CROP_WORKER_MIN_SHOT_SECONDS              | 1.5            | shorter shots merge into the previous shot                                 |

**Deploy ordering (receiver first):** set `CROP_WORKER_API_KEYS` here, verify
a wrong bearer returns 401 (not 503), THEN set manager's
`CROP_WORKER_BASE_URL` + `CROP_WORKER_API_KEY`.

## Development

```bash
pnpm --filter @forge/crop-worker dev        # tsx src/server.ts on :3011
pnpm --filter @forge/crop-worker test       # vitest run
pnpm --filter @forge/crop-worker typecheck
pnpm --filter @forge/crop-worker lint
pnpm --filter @forge/crop-worker build      # tsc -> dist/
```

Local smoke (no S3): point `CROP_WORKER_LOCAL_ARTIFACTS_DIR` at
`../manager/.tmp/artifacts` so manager and crop-worker share an artifact
tree, then POST a fingerprint job against a public Mux playback URL and poll
`GET /jobs/{workerJobId}`.

## Conventions

- Never read `process.env` outside `src/config/env.ts`.
- Request-path logs use the plain-string
  `[crop-worker] event=name key=value` format (Railway logsV2 drops
  JSON.stringify payloads from Node runtimes — see root CLAUDE.md).
- Service results use discriminated unions (`SubmitOutcome`,
  `BearerValidationOutcome`) instead of throwing across boundaries; typed
  error classes (`MissingBinaryError`, `CommandTimeoutError`,
  `RuntimeEnvError`) elsewhere.
- The job runner wraps the ENTIRE async body in try/catch/finally
  (fire-and-forget slot-leak guard — root CLAUDE.md Known Patterns).
