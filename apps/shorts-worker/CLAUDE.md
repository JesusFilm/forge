# apps/shorts-worker — retained devotional media worker

## Scope and ownership

This authenticated Node HTTP service still executes the Mastra devotional workflow.
The old Shorts prepare/caption/render service path was retired in feat-462. General
Studio rendering uses `apps/studio-render`; it does not execute generated code here.
Keep the active Mastra devotional clients, signed transfers, shared compositions,
fonts, source utilities and queue behavior. Historical `shorts` names do not imply
an active Shorts authoring path.

Mastra owns devotional workflow state and Workspace inputs/outputs. Worker receives
short-lived attempt-bound capabilities, processes media and returns portrait/wide
outputs; it never owns durable Workspace credentials. Read
`docs/runbooks/devotional-workspace-cutover.md` before changing that retained
workflow's transfer or recovery boundaries; it is not the Studio cutover runbook.

## HTTP and queue contracts

- `/health` is public. `/jobs` submission/status/cancellation and devotional input/
  artifact routes enforce `SHORTS_WORKER_API_KEYS` with timing-safe full-list comparison.
  Production missing configuration returns 503; missing/wrong bearer returns 401.
- `POST /jobs` admits only `kind: "devotional-render"`, with runId, inputAssetId,
  outputAssetId, inputHash and optional workspaceTransfer. Signed-transfer callers
  use exact attempt/key/digest/expiry grants. Retained optional local/legacy transfer
  behavior remains for existing consumers. Retired `prepare`/`render` bodies return
  400 before reserving capacity.
- One render lane defaults to concurrency 1 and pending+running limit 2. Dedupe
  `devotional-render:{outputAssetId}:{inputHash}` reattaches only active jobs.
  Completed/failed records expire after 24 hours; active jobs remain. Cancellation
  aborts the active executor or removes the queued entry. Keep failure cleanup in
  try/catch/finally so slots cannot leak.
- TERM/INT closes readiness and admission immediately. One absolute five-second
  grace includes queued/running cancellation, actual cleanup and HTTP handler
  settlement, even after a client disconnects. Repeated signals never reset it.
  Ordinary job cleanup has the same bounded allowance; unconfirmed cleanup
  permanently closes queue admission and retires the worker unsuccessfully.
  A successful cancellation flag alone never proves resources were cleaned up.
- Registry/dedupe are in-memory: exactly one replica remains required. Mastra owns
  bounded recovery when restart loses job IDs; replica scaling cannot preserve
  this polling contract. Increasing the queue does not increase render concurrency.
- Enqueue-time deadlines include queue wait. Worker defaults to 70 minutes, capped
  at 4,740,000 ms, strictly below Mastra's 80-minute poll ceiling. Preserve at least
  60 seconds for cleanup/observation. FFmpeg invocations also use remaining budget.
- Artifact keys stay flat and validated. Authenticated portrait/wide output reads
  stream Range/HEAD; they must not expose inputs or buffer large media bodies.

## Code boundaries

- `src/routes/jobs.ts` handles admission; `jobs.ts` owns bounded queue/dedupe.
- `devotional-render.ts` owns media preparation/rendering and browser teardown;
  `render-engine.ts` preserves the injected Remotion adapter with lazy imports.
  Engine construction does not launch Chromium. Close each job's browser in finally.
- `devotional-transfer.ts` validates capability origin, exact key/prefix, methods,
  expiry and digests. Reject redirects, private hosts and incorrect attempts;
  do not log signed URLs. Shared storage/auth/deadline/FFmpeg/source utilities remain.
- Source URLs use exact-host allowlists and HTTPS in production. Keep source
  validation before subprocess work and derive protocol whitelists in code.
  Bucket hosts are not FFmpeg source hosts. Local HTTP needs an explicit allowlist.
- Runtime configuration belongs only in `src/config/env.ts`. Errors extend the typed
  WorkerError family; structured failures retain honest retryability. Request logs
  use `[shorts-worker] event=name key=value` (Railway logsV2 behavior).
- Remotion dependencies remain exact and in lockstep with compositions/Manager.
  Keep React-free server subpaths and lazy renderer imports. Shared fonts and
  devotional/studio composition entries must survive the legacy cutover.
- `scripts/detect-and-trim-snippet.mjs` still uses `@remotion/install-whisper-cpp` as
  an explicit devotional CLI tool. That dependency remains; the retired HTTP
  service's Whisper model/binary provisioning and startup requirements are gone.
  Studio source captions must still use canonical library tracks.

## Packaging and local verification

The Dockerfile builds from repo root and retains Node >=22.18, Chromium, FFmpeg,
fallback fonts and one prebuilt devotional bundle. It materializes transitive
`devotional-workspace`, `shorts-compositions` and `studio-contracts` sources and
workspace symlinks: Node cannot strip TypeScript copied inside node_modules.
Keep dependency/browser layers independent of app source. `prebundle [outDir]`
builds the devotional entry only; `SHORTS_WORKER_DEVOTIONAL_BUNDLE_DIR` selects it.
Production startup verifies that bundle, keys/storage and capability origin.

Use package scripts for tests/types/lint/build and prebundle. The retired legacy
prepare/render host smoke no longer exists. Meaningful retained coverage includes
HTTP admission/auth/cancel/dedupe, devotional transfer/render cleanup, engine option
forwarding and startup validation. Actual image acceptance requires building and
HTTP-driving that exact image; TypeScript and a host prebundle are not image proof.
Do not relabel the old unperformed feat-178 container acceptance as passed.

## Deployment boundaries

Normal reviewed PR-to-main Railway deployment only. Set Config-as-code Path to
`apps/shorts-worker/railway.toml`; otherwise Railway may ignore it. Preserve one
replica, receiver-first keys, private storage and no durable Workspace credentials
in Worker. Worker API keys remain distinct from crop-worker keys. Verify health
and wrong/missing bearer denial before enabling the caller. No deployment or
provider acceptance is implied by the feat-462 local retirement slice.

Generated-code containment work belongs to the separate Studio renderer. Read
`docs/solutions/security-issues/studio-contained-render-and-immutable-watch-publication.md`
for that boundary, and `docs/solutions/security-issues/studio-dynamic-runtime-proof.md`
for the retained feasibility scripts. Local proof does not establish deployed
containment or full Studio release acceptance.
