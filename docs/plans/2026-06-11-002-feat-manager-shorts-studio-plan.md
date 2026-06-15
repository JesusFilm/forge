---
title: "Shorts Studio — vertical shorts from library videos via Remotion"
type: feat
status: completed
date: 2026-06-11
origin: docs/brainstorms/2026-06-11-manager-shorts-studio-requirements.md
---

# Shorts Studio — manager section for 9:16 shorts with word-level captions + waveform

## Enhancement Summary

**Deepened on:** 2026-06-11 by four parallel review agents (architecture,
security, performance, simplicity) after initial research (repo patterns,
institutional learnings, Remotion 4.x docs, shorts-pipeline best practices)
and SpecFlow analysis.

Key changes from the deepening pass:

1. **Compositions package restructured around subpath exports** so manager
   server/workflow code never imports React/Remotion (`/schema`,
   `/captions` pure; root = Player-only; `/entry` = worker-only).
2. **Security hardening pinned**: worker-side exact-host source allowlist
   (Mux only, S3 host excluded), `clipUrl` removed from the operator draft
   schema (server-injected), loopback server bind/port/scope invariants,
   supply-chain pins (model SHA-256, whisper.cpp commit SHA, base image
   digest), server-derived audit fields.
3. **Performance restructuring**: per-kind worker lanes (prepare/render),
   deadline math covering queue wait, output MP4 moved OFF the buffering
   artifact route onto the new streaming handler, Remotion bundle baked at
   Docker build, pinned concurrency/cache knobs, ffmpeg input-seek argv
   pinned by test, downscaled-blur for the Frame template.
4. **Scope cuts (MVP)**: 2 templates (Focus, Frame — active-word accent is
   default behavior); caption editor = token text edit + delete + on/off
   (no merge/split redistribution); last-write-wins drafts (no 409
   ceremony, draftVersion kept for stale-output detection); unsupported
   language behaves like no-audio; no safe-area overlay toggle; no
   queuePosition; Smart Crop source reuse unconditionally deferred to
   fast-follow; Remotion version lockstep pinned exact.

## Overview

New manager dashboard section ("Shorts") where an admin picks any library
video, sets in/out points, and composes a 1080x1920 vertical short via
branded Remotion templates — word-level animated "karaoke" captions, an
audio-waveform visual, optional title text, and style knobs — previewed
interactively in the browser, then rendered server-side and delivered as a
new Mux asset plus a downloadable MP4.

Topology clones Smart Crop (feat-173, the repo's law for heavy AI+media):
durable control loop in **manager** (`workflow` SDK, JobRecord with an
`options.shorts` discriminator, zero admin schema changes), bytes in a new
dedicated **apps/shorts-worker** (Docker: Remotion + Chromium + whisper.cpp +
ffmpeg) that manager polls, and a new **packages/shorts-compositions**
package shared by manager's `<Player>` preview and the worker's render for
parity-by-construction. Mastra is NOT involved — there are no bounded LLM
decision calls in this pipeline (whisper is byte work; it runs in the
worker per the law).

## Problem Statement

Producing vertical social cuts today requires a video editor per clip, so
almost none get made (see origin doc Problem Frame). Admins need
self-service: library video → on-brand short in minutes. Requirements
R1–R9 + scope boundaries are authoritative in the origin doc
(`docs/brainstorms/2026-06-11-manager-shorts-studio-requirements.md`).

## Proposed Solution

```
apps/manager                          apps/shorts-worker (NEW, Docker)
┌──────────────────────────┐          ┌─────────────────────────────────┐
│ /dashboard/shorts UI     │          │ plain node:http (crop-worker     │
│  list / new (picker +    │          │ skeleton): POST /jobs, GET /jobs │
│  in-out scrub) / [id]    │          │ /{id}, GET /health, bearer CSV   │
│  (caption editor, knobs, │          │ TWO LANES (1+1): prepare, render │
│  Remotion <Player>)      │  submit  │ prepare: ffmpeg input-seek HLS → │
│ durable workflows:       │ ───────► │  clip MP4 (30fps) + 16kHz WAV →  │
│  shortsPrepare /         │  poll    │  whisper large-v3-turbo words    │
│  shortsRender            │ ◄─────── │ render: renderMedia over baked   │
│ Mux output asset         │          │  bundle, 1080x1920 H.264         │
│  (record-before-poll)    │          └────────────────┬────────────────┘
└────────────┬─────────────┘                           │
             │ S3 artifacts: {assetId}/shorts-*.{json,mp4}               │
             └───────────────────────┬─────────────────┘
                                     ▼
                    packages/shorts-compositions (NEW)
        subpath exports: /schema (zod, pure) · /captions (pure helpers)
        · root (Root + templates, Player-only) · /entry (worker bundle)
```

### Key decisions (origin + research + SpecFlow + deepening)

1. **Per-short storage prefix** (SpecFlow C1): `options.shorts.assetId =
"{muxAssetId}-short-{suffix}"` (suffix = 8-char alphanumeric minted at
   create). Multiple shorts per video never collide; matches storage
   validator `SAFE_KEY_PATTERN /^[a-zA-Z0-9_-]+$/` and
   `getJobArtifactStorageAssetId` indirection.
2. **Phase state machine + lifecycle contract** (SpecFlow C2, arch P2-2):
   `JobStatus` stays closed. UI/API source of truth is `ShortsPhase` in a
   `shorts` metadata artifact entry (mirrors `SmartCropJobReport`):
   `queued → preparing → ready_for_review → rendering → mux_processing →
completed`, failures `prepare_failed | render_failed`, annotations
   `transcription_skipped_no_audio | transcription_unsupported_language`.
   After PREPARE the workflow ends with `job.status = "completed"` + phase
   `ready_for_review`. **Lifecycle contract:**
   - Render launch allowed from phase ∈ {ready_for_review, render_failed,
     completed}; retry-prepare (`force: "prepare"`) allowed from any
     non-running phase including `ready_for_review` (the generic retry
     gate `status === "failed"` does NOT apply to the shorts routes —
     they gate on phase, not status).
   - Render launch resets/replaces the render-step subset of the steps
     array in place (prepare steps preserved) — mirrors retry's
     reset-failed-steps semantics; no duplicate step rows on re-render.
   - Double-launch guard: the render route claims an in-memory TTL slot
     (clone of retry's `claimRetrySlot`, sync-claim before any await,
     try/finally release) as first line; worker `render:{assetId}:
{propsHash}` dedupe is the second line.
   - Single-writer rule for phase: routes write only launching intents;
     the workflow owns all other phase transitions (phase lives in a
     read-modify-write metadata artifact).
3. **In/out immutable after prepare** (SpecFlow I3): fixing bounds =
   "Clone short" (navigates to `/new` with prefilled query params — no
   artifact/draft copying). No bounds editing v1.
4. **Draft model — last-write-wins + provenance** (simplicity cut, keeps
   the data-loss guards): whisper output is an immutable artifact.
   Operator edits live in a draft artifact with `draftVersion` (int,
   incremented server-side on every save), `captionsGeneratedAt`
   provenance, `updatedBy` **derived from the authenticated actor, never
   the request body** (clone smart-crop approve's actor pattern). No
   optimistic-concurrency 409 (3-operator tool; lost tweaks are
   recoverable). Render pins `draftVersion`; render meta records
   `renderedDraftVersion` + `propsHash`; UI shows a stale-output banner
   when draft has moved past the last render. Force-prepare warns it
   discards caption edits; edit UI refuses to apply overrides whose
   `captionsGeneratedAt` doesn't match the current captions artifact.
5. **No-audio / unsupported language — same degradation path** (SpecFlow
   C5/C6, simplified): worker ffprobes the clip; no audio stream →
   deterministic skip (`transcription_skipped_no_audio`, empty captions,
   editor hides caption + waveform knobs, render proceeds). Unmappable
   language (checked table `whisper-language.ts`, BCP-47 → whisper
   ISO-639-1, explicit `null` for unsupported) → identical behavior with
   `transcription_unsupported_language`. Whisper always runs with explicit
   `language`, never `auto`. Hallucination guard (MVP — ~15 lines): drop
   tokens from segments failing whisper's no-speech/avg-logprob
   thresholds. NO manual caption authoring v1.
6. **Media streaming route** (SpecFlow I1, arch P3-1, perf C2/O4): one NEW
   Range-capable streaming handler `GET /api/shorts/jobs/[id]/media/
[artifact]` serving logical keys `clip` (`shorts-clip-v1.mp4`) and
   `output` (`shorts-output-v1.mp4`) ONLY — fixed-literal artifact types,
   no client-supplied storage keys, `SAFE_KEY_PATTERN` re-validation of
   the prefix at read time. Semantics: stream (never buffer; S3 GetObject
   Range → web stream; local fallback `createReadStream({start,end})`),
   single-range only (reject multi-range), suffix ranges supported, 206 +
   `Content-Range`/`Accept-Ranges` (200 full-body without Range), ETag
   passthrough, `Cache-Control: private, max-age=3600` (artifacts
   immutable per prepare/render), 60s in-process cache of jobId → storage
   prefix (kills per-Range-request admin GraphQL getJob round trips).
   Auth model: any authenticated operator (documented — matches
   smart-crop artifact access; this is a shared internal tool). The
   legacy buffering artifact route is NOT used for any shorts media
   (output MP4 is 180–360MB; `readArtifact` buffers whole objects) and is
   NOT modified. Same-origin streaming → no bucket CORS preconditions.
7. **Worker render asset serving** (security P2-1 pinned): OffthreadVideo's
   ffmpeg path is CORS-exempt but `useWindowedAudioData` (waveform) is
   browser-fetch → worker downloads the clip to tmp and serves it via a
   loopback static server: **binds `127.0.0.1` explicitly, ephemeral port
   (listen on port 0), serves exactly one mapped path (`/clip.mp4`) and
   404s everything else, torn down in `finally`**, `Access-Control-Allow-
Origin: *` (safe given loopback bind). `clipUrl =
http://127.0.0.1:{resolvedPort}/clip.mp4` injected by the worker.
   Manager preview injects the manager media route URL for the same prop.
8. **propsHash contract** (arch P2-4): canonical props = operator draft
   knobs + caption pages + clip referenced **by artifact identity**
   (assetId + artifactType) — runtime URLs (`clipUrl`) excluded. Manager
   canonicalizes (sorted keys) and computes sha256 once; worker treats it
   as an **opaque** dedupe token (never recomputes). Dedupe keys:
   `prepare:{assetId}`, `render:{assetId}:{propsHash}`; caller job id
   excluded (re-attach semantics); manager client mirrors the same keys
   pre-submit. `compositionsVersion` deliberately NOT hashed: worker
   dedupe is in-flight-only (completed/failed never dedupe, crop-worker
   semantics) and deploys restart the worker, killing in-flight jobs — a
   stale-version re-attach window doesn't exist. Worker JSON body cap:
   crop-worker's 1MB default holds (worst-case 180s word tokens + draft ≈
   tens of KB) — checked, inherited deliberately.
9. **Pre-trim, never remote-seek long sources** (perf O3 pinned): ffmpeg
   **input-seek** (`-ss` before `-i`; argv ordering pinned by unit test
   AND real-binary smoke — output-seek on a 2h film transfers 4.5–9GB vs
   ~115–250MB input-seek) on the HLS URL, re-encode to local clip MP4:
   constant 30fps, explicit stream mapping (exactly one video stream —
   pinned rendition selection, not ffmpeg's highest-bandwidth default —
   and one audio stream), `preset veryfast` CRF 17 (intermediate only;
   Remotion re-encodes), `+faststart`. `-protocol_whitelist
https,tls,tcp,crypto,hls` on the source invocation. Worker re-clamps
   `startSec/endSec` against ffprobed source duration before building
   argv (never trusts caller bounds).
10. **Worker-side SSRF enforcement** (security P1-1): the worker re-parses
    `source.url` and asserts `protocol === "https:"` AND `hostname` exact-
    matches `SHORTS_WORKER_ALLOWED_SOURCE_HOSTS` (default
    `stream.mux.com`; **S3 endpoint host deliberately NOT in the source
    allowlist** — artifacts move via the SDK, not ffmpeg) before ANY
    ffmpeg/ffprobe spawn. Rejection unit tests required:
    `stream.mux.com.evil.com`, `127.0.0.1`, `169.254.169.254`, `file:`/
    `data:` smuggles.
11. **Fonts vendored** (arch P2-6, replaces google-fonts): woff2 files
    shipped inside the compositions package, loaded via `@remotion/fonts`
    `loadFont()` + `staticFile` — identical bytes in Player and renderer,
    no fonts.gstatic.com dependency inside production renders, no silent
    fallback-font renders. Docker image adds `fonts-noto-color-emoji
fonts-noto-cjk` for fallback glyphs only. MVP families: Montserrat
    (700/900) + Inter (400/600).
12. **Mux output**: existing `createMuxAsset` from presigned artifact URL
    (TTL 7200s > Mux ingest window; **presigned URL never logged in full
    and never returned in any API/SSE payload** — host-only provenance
    convention applies) with record-before-poll idempotency
    (`shorts-mux-output-v1.json` written BEFORE readiness polling; errored
    assets recreated). Download MP4 served via the streaming route
    (decision 6), NOT Mux static renditions, NOT the legacy artifact
    route.
13. **Licensing**: JFP is a non-profit → free Remotion license per
    LICENSE.md ("a non-profit or not-for-profit organization"). No license
    key needed for server renders. Action item (non-blocking): one-line
    confirmation email to hi@remotion.dev; re-verify at Remotion 5.0.
14. **Templates — two for MVP** (simplicity cut; R6 "2–3" satisfied), both
    enforcing the cross-platform safe area by construction (captions ≥
    320px from bottom, ≥130px from top, ≥60px from sides on 1080x1920; no
    operator-facing overlay toggle — constraints are unviolatable):
    - **Focus**: source center-cropped to fill 9:16; captions center-band;
      waveform bar cluster bottom-center above safe margin.
    - **Frame**: source letterboxed at native aspect over a blurred scaled
      copy — implemented as **blur of a heavily downscaled copy (~270x480)
      upscaled** (perf C3: full-res per-frame CSS blur on CPU is 2–4x
      slower and threatens the render deadline; downscaled blur is
      visually identical and ~16x cheaper); optional title above video;
      captions below; waveform bottom.
      Word-pop active-word accent is the DEFAULT caption behavior (shared
      `CaptionPages` primitive), not a third template. Bold ships later as a
      registry preset. Knobs (zod): `templateId`, `accentColor` (zColor),
      `captionPosition` (band presets), `captionFont` (enum of packaged
      fonts), `waveformStyle` (`bars | none`), `title` (optional string),
      `showCaptions` (bool). **Template constraint (security P3-2):
      operator-supplied strings (title, caption tokens) render ONLY as React
      text children — never `dangerouslySetInnerHTML`, never interpolated
      into style strings or CSS url().** Smart Crop source reuse (R4
      opportunistic clause): unconditionally deferred to fast-follow,
      recorded in feat-178.
15. **Split schemas** (security P1-2): `DraftSchema` (operator-editable:
    knobs + caption pages/tokens) contains NO `clipUrl`, `fps`,
    `clipDurationSec`, or any render-derived field. `ShortInputProps` =
    DraftSchema fields + server-injected `{clipUrl, fps, clipDurationSec}`
    assembled at compose time (manager for preview, worker for render).
    Any URL-typed prop is scheme-pinned (https or the loopback literal),
    never bare `z.string().url()`.

## Technical Approach

### New package: `packages/shorts-compositions` (`@forge/shorts-compositions`)

Source-shipped like `packages/video-player` (NO build step — arch P3-3);
**subpath exports** (arch P1-1) with a hard import rule — manager
server/workflow code may import ONLY `/schema` and `/captions`:

```
packages/shorts-compositions/
├── package.json          # exports: ".", "./schema", "./captions", "./entry"
│                         # remotion deps pinned EXACT (no ^) — see below
├── fonts/                # vendored woff2 (Montserrat 700/900, Inter 400/600)
├── src/
│   ├── schema.ts         # zod only, ZERO React/Remotion imports:
│   │                     #   DraftSchema, ShortInputProps, knob enums
│   ├── captions.ts       # pure: whisper Caption[] -> TikTok pages (wraps
│   │                     #   @remotion/captions createTikTokStyleCaptions),
│   │                     #   token-text override application (timings kept),
│   │                     #   token/page delete; NO merge/split (deferred)
│   ├── version.ts        # COMPOSITIONS_VERSION constant (explicit, bumped
│   │                     #   on template-affecting changes — package.json
│   │                     #   versions are dead 0.0.1 stamps in this repo)
│   ├── index.ts          # Root + templates registry (Player consumers)
│   ├── Root.tsx          # <Composition id="short" calculateMetadata>
│   ├── entry.ts          # registerRoot — worker bundle entry ONLY
│   ├── calculate-metadata.ts  # durationInFrames = clipDurationSec * fps
│   ├── templates/
│   │   ├── registry.ts   # [{id, label, defaults}] — Focus, Frame
│   │   ├── Focus.tsx  Frame.tsx
│   │   └── primitives/   # SafeArea, CaptionPages (active-word default),
│   │                     #   Waveform (useWindowedAudioData+visualizeAudio,
│   │                     #   windowInSeconds 20–30), SourceVideo
│   │                     #   (OffthreadVideo crop/letterbox, downscaled-blur)
│   └── *.test.ts         # captions overrides, schema guards, version-lockstep
└── (no remotion.config.ts — worker bundles via entry.ts)
```

Deps: `remotion`, `@remotion/captions`, `@remotion/media-utils`,
`@remotion/fonts`, `zod`. Tests include: (a) a module-graph guard — import
of `/schema` and `/captions` pulls no `remotion`/`react` module; (b)
**Remotion version-lockstep test** (arch P2-1) — all `remotion`/
`@remotion/*` entries across `packages/shorts-compositions`,
`apps/shorts-worker`, `apps/manager` package.jsons are the SAME exact
pinned version (Remotion throws at render time on mismatch; caret drift
fails in production Docker, not CI).

### New app: `apps/shorts-worker` (`@forge/shorts-worker`)

Clone the crop-worker skeleton (server.ts DI factory, routes/jobs.ts 202 +
snapshot polling, auth.ts timing-safe CSV bearer with production-gated
dev-bypass, deadline.ts enqueue-time budgets, storage.ts S3-or-local with
flat-key validation, slot-leak-guarded try/finally queue, plain-string
`event=` logging). Deltas:

- **Two lanes** (perf C1): independent prepare and render lanes, 1
  concurrent job each, queue limit 2 per lane (`queue_full` → 409 typed).
  Enqueue-time deadlines sized to cover own budget + one queued
  predecessor: prepare deadline 45min, render deadline 70min. Manager poll
  ceilings strictly above (50min / 80min). Per-invocation subprocess
  timeouts capped at remaining deadline budget. No queuePosition field
  (cut); snapshot exposes `status: queued|running|completed|failed` +
  progress.
- `src/prepare.ts` — allowlist-validated source URL (decision 10) → ffmpeg
  input-seek trim per decision 9 → ffprobe meta (duration/fps/hasAudio) →
  if audio: 16kHz s16 mono WAV → whisper transcribe
  (`tokenLevelTimestamps: true`, explicit language, `onProgress`) →
  hallucination filter → artifacts: `shorts-clip-v1.mp4`,
  `shorts-clip-meta-v1.json` (host-only source provenance, bounds,
  generatedAt), `shorts-captions-v1.json` (Caption[] + language + model +
  generatedAt).
- `src/render.ts` — request carries final resolved inputProps (minus
  clipUrl) + opaque propsHash → download clip artifact to tmp → loopback
  single-file server per decision 7 → `selectComposition` + `renderMedia`
  against the **baked bundle directory** (see Dockerfile) with pinned
  knobs: explicit `concurrency` (env, default 2 on 4 vCPU — x264 needs
  the other cores), `offthreadVideoCacheSizeInBytes` capped ~1GB (default
  scales with free RAM → OOM-killer risk at 8GB), `timeoutInMilliseconds:
120000` (per-delayRender, not the job ceiling), `onProgress` → job
  progress throttled ~5% steps. Browser opened per job via `openBrowser()`
  and passed as `puppeteerInstance` to both calls, closed in `finally` —
  no cross-job reuse (memory-creep insurance; saves nothing meaningful).
  → ffprobe sanity (1080x1920, duration ±0.5s) → `shorts-output-v1.mp4` +
  `shorts-render-meta-v1.json` (propsHash, renderedDraftVersion,
  COMPOSITIONS_VERSION actually bundled, generatedAt).
- `src/whisper.ts` — wrapper over `@remotion/install-whisper-cpp`
  `transcribe()` + `toCaptions()`. Install + model download happen at
  Docker BUILD; runtime asserts model presence at boot (fail fast).
- **Dockerfile strategy** (arch P2-3 — first Dockerfile app in the fleet,
  first worker consuming a workspace package at runtime):
  - Repo-root build context; `.dockerignore`; corepack pnpm pinned to root
    `packageManager`; multi-stage on `node:22-bookworm-slim` **pinned by
    digest**.
  - Workspace materialization: `pnpm deploy --filter @forge/shorts-worker
--prod` style output that carries the compositions package source
    (verify TSX sources land; the package is source-shipped).
  - apt (reviewed allowlist): `libnss3 libdbus-1-3 libatk1.0-0 libasound2
libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1
libgbm-dev libcups2 libcairo2 libpango-1.0-0 libatk-bridge2.0-0
fonts-noto-color-emoji fonts-noto-cjk ffmpeg` (+ build-stage `cmake
build-essential git` for whisper.cpp).
  - Supply-chain pins (security P2-4): `@remotion/install-whisper-cpp`
    exact version; whisper.cpp at a **commit SHA**; model `large-v3-turbo`
    verified against a recorded **SHA-256 in the build** (build fails on
    mismatch); `npx remotion browser ensure` (chrome-headless-shell pinned
    transitively by the exact Remotion version).
  - **Bundle baked at build** (perf O1): a build script runs Remotion
    `bundle()` over `@forge/shorts-compositions/entry` and bakes the serve
    dir into the image; runtime `renderMedia` takes the local path —
    webpack never runs at runtime, `@remotion/bundler` is a build-time
    dep, first render after deploy costs the same as the Nth.
  - **Layer ordering** (perf): apt + model + browser-ensure layers BEFORE
    source COPY + bundle, so code-only deploys push/pull small layers, not
    the ~1.6GB model.
  - `railway.toml`: `dockerfilePath`, `numReplicas = 1` (in-memory
    lanes/dedupe), healthcheck `/health`. Dashboard Config-as-code Path
    MUST be set (silent-ignore precedent).
  - **Real-binary smoke runs INSIDE the container** (arch P2-3): `docker
build` + `docker run` smoke = lavfi synthetic source → prepare
    (whisper on the real model) → render via baked bundle → ffprobe
    1080x1920 — the only test proving Chromium launches, fonts resolve,
    model loads, and the bundle finds the entry. A host-side smoke
    (whisper-optional) remains for fast local iteration.
- Env (plain Zod, assert in production): `SHORTS_WORKER_API_KEYS` (CSV;
  **must be a distinct secret from `CROP_WORKER_API_KEYS`** — a shared
  value would make one worker's bearer authorize the other),
  `RAILWAY_S3_*` (optional, local fallback `.tmp/artifacts`),
  `SHORTS_WORKER_RENDER_CONCURRENCY`, `SHORTS_WORKER_ALLOWED_SOURCE_HOSTS`
  (default `stream.mux.com`), lane queue caps.

### Manager changes

- **Types** (`src/types/job.ts`): `JobOptions.shorts?: ShortsJobOptions`
  ({assetId, sourceMuxAssetId, sourcePlaybackId, sourceCoreId?, clip:
  {startSec, endSec}, language: {bcp47, whisper: string | null},
  requestedBy}); `WorkflowStepName` += `shorts_prepare | shorts_render |
shorts_mux_output` (source-resolve folded into prepare — simplicity);
  `ShortsJobReport` metadata artifact type (phase, annotations,
  draftVersion, lastRenderedDraftVersion, output {muxAssetId, playbackId,
  ready}).
- **Steps inventory** (`src/lib/workflow-steps.ts`):
  `buildShortsInitialSteps(kind: "prepare" | "render")`; render launch
  resets/replaces render steps in place (lifecycle contract, decision 2).
- **Workflows** (`src/workflows/shortsStudio.ts` + `launchShorts.ts`):
  `shortsPrepare` = submit+poll worker prepare (progress via
  `createStepProgressReporter`) → report phase `ready_for_review`, job
  completed. `shortsRender` = read captions + draft artifacts → resolve
  final props (apply token overrides via `/captions` helpers) + propsHash
  (canonical, decision 8) inside a `"use step"`; audit copy written as
  `shorts-render-props-v1.json`; props sent inline in the worker submit
  body → submit+poll worker render → Mux output step (record-before-poll,
  smart-crop pattern verbatim) → finalize report. Failure classification:
  `throwStepFailure` envelopes; deterministic (bad source, missing clip
  artifact, unsupported props) → `FatalError`; transport/S3/presign →
  retryable. Step bodies call plain service helpers; never nested
  `start()`. Only scalars/ids cross step boundaries.
- **Worker client** (`src/services/shorts-worker.ts`): clone crop-worker
  client (15s submit timeout, 5s poll, bounded resubmit on `job_lost`,
  queue_full backoff, discriminated envelopes, retryable forced false
  after resubmit budget). Poll ceilings: prepare 50min, render 80min.
  Mirrors dedupe keys (decision 8).
- **Whisper language map** (`src/lib/whisper-language.ts`): BCP-47 →
  whisper ISO-639-1, explicit `null` unsupported; unit-tested.
- **API routes** (all: `authenticateRequest`, Zod, 503 `config_missing`,
  plain-string logs; audit fields from the authenticated actor — never the
  body; `MANAGER_API_KEY` bearer records the service principal):
  - `POST /api/shorts/jobs` — validate coreId/muxAssetId + clip bounds
    (5–180s, end>start, within live `getMuxAsset` duration — NEVER
    `mux_videos.duration`), resolve playbackId (non-public policy → typed
    `validation_failed`, SpecFlow I6), mint short assetId, `createJob` +
    `launchShorts("prepare")` → 201.
  - `GET /api/shorts/jobs` — list (filter `options.shorts`).
  - `GET /api/shorts/videos/[coreId]` — per-video resolution
    (`videosByCoreIds` → muxAssetId, playbackId, duration via Mux,
    language, whisper-support flag, disabled-with-reason for
    null/signed). Picker LIST reuses existing `GET /api/videos`
    (coverage read model) — no new list route.
  - `POST /api/shorts/jobs/[id]/draft` — validate against `DraftSchema`
    (no clipUrl/fps/duration fields accepted), last-write-wins, increment
    `draftVersion` server-side, write draft artifact.
  - `POST /api/shorts/jobs/[id]/render` — phase gate per lifecycle
    contract, in-memory TTL claim slot (sync-claim, try/finally), pin
    draftVersion, launch render workflow; `requestedBy` from actor.
  - `POST /api/shorts/jobs/[id]/retry` — `{force?: "prepare" | "render"}`;
    force-prepare response confirms caption-edit discard.
  - `GET /api/shorts/jobs/[id]/media/[artifact]` — streaming route per
    decision 6 (`clip` | `output` literals only).
- **Env** (`src/config/env.ts`, ALL `.optional()`): `SHORTS_WORKER_BASE_URL`,
  `SHORTS_WORKER_API_KEY`.
- **UI** (`src/app/dashboard/shorts/` + `src/features/shorts/`):
  - Nav item + breadcrumb in `manager-shell.tsx`.
  - `page.tsx` — list (poll 5s, smart-crop screen patterns: phase chips,
    thumbnail, clone/download actions).
  - `new/page.tsx` — picker (search over existing coverage route,
    disabled-with-reason rows) → video.js HLS scrubber with in/out handles
    - 5–180s guardrail → submit.
  - `[id]/page.tsx` — detail: steps table (collapsible-step-row patterns);
    when `ready_for_review`: **caption editor with the MVP contract:
    token text edit (timings preserved), token/page delete, captions
    on/off — nothing else** (the scope-creep magnet; merge/split is a
    named fast-follow), template picker (2), knob controls, Remotion
    `<Player>` (`'use client'`, `lazyComponent`, **memoized inputProps,
    text commits debounced 150–300ms, Player never keyed by
    draftVersion** — remount resets playback and refetches audio windows),
    stale-output banner (draftVersion > renderedDraftVersion), Render
    button, output section (Mux playback + download via streaming route +
    clone), retry controls. SSE/report payloads carry host-only
    provenance — no full URLs (presigned or loopback) reach the browser.

### Roadmap + docs

- `docs/roadmap/media-generation/feat-178-manager-shorts-studio.md`
  (owner vlad, P1, in-progress, agent-optimized body; fast-follows
  recorded: Smart Crop source reuse, merge/split editor, Bold preset,
  manual captions, AI highlight suggestions).
- `apps/shorts-worker/CLAUDE.md` (operating manual: lanes, deadlines,
  dedupe, allowlist invariants, dev-bypass note "verify wrong bearer →
  401 not 503", Docker/layer rules, smoke).
- Manager CLAUDE.md section: Shorts Studio contracts + deploy
  preconditions + one-sentence note that ElevenLabs cue-level
  transcription (enrichment) and whisper word-level (shorts) deliberately
  coexist — words are the product here; do not "unify."

## Implementation Phases (single PR, ordered commits)

1. **Compositions package**: schema/captions/version subpaths (+module-
   graph + lockstep tests), two templates, primitives, fonts, entry.
   Verify: `pnpm --filter @forge/shorts-compositions test|typecheck`
   (source-shipped; no build).
2. **shorts-worker**: skeleton clone (+unit tests: auth/lanes/deadline/
   storage/SSRF rejections), prepare pipeline (injectable RunCommand;
   whisper wrapper; argv-ordering test), render pipeline (baked-bundle
   path, loopback server invariants test, per-job browser), Dockerfile +
   railway.toml + container smoke. Verify: `pnpm --filter
@forge/shorts-worker test|typecheck|build` + host smoke + `docker
build` smoke.
3. **Manager pipeline**: types, steps, workflows, worker client (+tests:
   dedupe mirror, resubmit budget, timeout envelopes), language map.
4. **Manager API routes** (+tests: bounds/validation, draft schema rejects
   server-injected fields, phase gate + claim slot sync-throw, streaming
   route Range semantics incl. suffix range + multi-range rejection).
5. **Manager UI**: list / picker / detail / caption editor / Player.
6. **Docs + roadmap + memory**: CLAUDE.mds, feat-178, deploy
   preconditions.

## System-Wide Impact

- **Interaction graph**: create route → `createJob` (admin GraphQL JSON
  options) → `start(shortsPrepare)` → worker poll loop → artifact writes →
  `publishJobEvent` SSE on every job write (existing). Render route →
  relaunch on same JobRecord (retry mechanics + claim slot — no new admin
  surface). Mux asset creation reuses existing service + passthrough
  jobId.
- **Error propagation**: worker → client discriminated envelopes →
  `throwStepFailure` → FatalError vs retryable (3x SDK) → `failJob` +
  `JobError.operatorHint`. Renders never crash manager (process-isolated).
  Mux ingest failure → recorded asset recreated on retry.
- **State lifecycle risks**: artifacts provenance-stamped; skip paths
  parse + provenance-check (not just `artifactExists`). Draft saves
  last-write-wins by decision (3 operators; documented). `completed` is
  no longer terminal for shorts jobs — shorts routes gate on phase;
  generic retry route untouched (gates on `failed`, never sees shorts
  semantics). Orphaned S3 artifacts on abandoned drafts: accepted v1,
  stance recorded in worker CLAUDE.md.
- **API surface parity**: web/mobile/tv untouched; admin schema untouched.
  Generic `/api/jobs` UI shows shorts jobs with unknown step names —
  renders gracefully (smart-crop precedent).
- **Integration risks unit tests won't catch**: Chromium launching in the
  image, fonts resolving, whisper model loading, bundle entry resolution,
  ffmpeg accepting the input-seek argv → all covered by the in-container
  real-binary smoke; preview/render parity → vendored fonts + shared
  composition + manual verification checklist.

## Acceptance Criteria

- [x] Admin creates a short from a public-playback library video: picker →
      scrub in/out (5–180s enforced) → prepare completes → caption editor +
      preview → render → Mux playback + MP4 download via streaming route.
      (R1–R8)
- [x] Word-level captions animate with active-word accent in both
      templates; caption block honors safe-area constraints by
      construction. (R5, R6)
- [x] Caption text edits persist across re-renders; force-prepare warns
      and discards; stale-output banner appears when draft outruns last
      render. (R9, C3/C4)
- [x] No-audio and unsupported-language clips render caption-less with the
      phase annotation visible. (C5/C6)
- [x] Re-render after an edit produces a NEW worker job (propsHash
      dedupe); identical resubmit re-attaches to the in-flight render. (I4)
- [x] Retry reuses clip+captions artifacts (no re-transcription) unless
      force-prepare. (R9)
- [x] Worker rejects non-allowlisted source hosts (incl. suffix-spoof,
      loopback, link-local, scheme smuggles) before any subprocess spawn.
- [x] Draft route rejects payloads containing server-injected fields
      (clipUrl/fps/clipDurationSec).
- [x] Streaming route: 206 + Content-Range on single ranges, suffix ranges
      work, multi-range rejected, no full-object buffering.
- [x] Remotion version-lockstep test passes; module-graph guard proves
      `/schema` + `/captions` are Remotion/React-free.
- [x] All manager env vars optional: unconfigured envs → 503
      config_missing; worker boots fail-fast on missing model/keys in
      production only.
- [ ] Tests green: package tests plus typecheck, lint, build; host smoke
      passes; container smoke passes. Test command:
      `pnpm --filter @forge/shorts-compositions --filter @forge/shorts-worker --filter @forge/manager test`.
      (Tests + host smoke pass; the CONTAINER smoke — docker build + run,
      the in-image Chromium/fonts/model/bundle proof — has not been
      executed yet; tracked as remaining deploy work on feat-178.)
- [x] Roadmap feat-178 created; CLAUDE.md files updated.

## Dependencies & Risks

- **Remotion license**: free for non-profits per LICENSE.md — confirm by
  email (non-blocking); re-verify at 5.0 (license text changes + binary
  provenance re-check).
- **Docker on Railway**: first Dockerfile app in the worker fleet;
  Config-as-code Path MUST be set in dashboard. Image ~3.5–4.5GB
  (Chromium + model) — layer ordering keeps code deploys small.
- **Render perf**: provisional numbers to validate by benchmark during
  implementation (named worst case: **Frame template at 180s** — 5,400
  frames; 4–12fps screenshot rate on 4 vCPU → 8–22min Focus, downscaled-
  blur Frame should land in the same band; whisper large-v3-turbo 180s ≈
  2–10min, ~2.2–2.6GB subprocess RSS). Target container 4 vCPU / 8GB;
  memory is sequenced (whisper and Chromium never co-resident within a
  lane), CPU is the constraint.
- **Deploy preconditions (receiver-first)**: 1) create shorts-worker
  service + S3 vars + `SHORTS_WORKER_API_KEYS` (distinct secret from
  crop-worker's), verify wrong bearer → 401-not-503; 2) set manager
  `SHORTS_WORKER_BASE_URL/_API_KEY`. No bucket CORS needed (same-origin
  streaming). No mastra changes.
- **Whisper quality on low-resource languages**: mitigated by the
  explicit unsupported path; not a launch blocker.

## Verification

```bash
pnpm --filter @forge/shorts-compositions test && pnpm --filter @forge/shorts-compositions typecheck
pnpm --filter @forge/shorts-worker test && pnpm --filter @forge/shorts-worker typecheck && pnpm --filter @forge/shorts-worker build
pnpm --filter @forge/manager test && pnpm --filter @forge/manager typecheck && pnpm --filter @forge/manager lint && pnpm --filter @forge/manager build
pnpm --filter @forge/shorts-worker smoke           # host: lavfi -> prepare (whisper-optional) -> render -> ffprobe
# container smoke: docker build + run smoke inside image (Chromium/fonts/model/bundle proof)
# Tier-2 /ce-code-review BEFORE push (mandatory: new app + new package + auth surface, >>400 LOC)
# Manual: MANAGER_DATA_MODE=mock manager + local worker; browser flow per acceptance criteria
```

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-06-11-manager-shorts-studio-requirements.md](../brainstorms/2026-06-11-manager-shorts-studio-requirements.md)
  — decisions carried forward: manual in/out first (AI highlights
  fast-follow); simple framing + opportunistic Smart Crop reuse (now an
  explicit fast-follow); word-level AI transcription (the word-pop style
  is the product); Mux asset + download; starter template set with knobs
  (2 ship, Bold preset later); durable retryable jobs that never re-pay
  transcription. Scope boundaries honored (no publishing, 9:16 only,
  single clip, no agent-generated templates, no admin schema changes).

### Deepening reviews (2026-06-11)

- Architecture: subpath exports, version lockstep, lifecycle contract,
  Dockerfile/pnpm-deploy strategy, propsHash canonicalization, vendored
  fonts, COMPOSITIONS_VERSION constant, source-shipped package.
- Security: worker-side exact-host allowlist + rejection tests, split
  draft schema (clipUrl server-injected), loopback bind/port/single-file
  invariants, supply-chain pins, actor-derived audit fields, presign log
  hygiene, distinct worker bearers, template text-children constraint.
- Performance: two lanes + queue-aware deadline math, streaming route for
  output MP4 (legacy route buffers — 180–360MB), baked bundle, pinned
  concurrency/cache knobs, input-seek argv pins + rendition mapping +
  veryfast intermediate, clip-route caching, Player memoization rules.
- Simplicity: cuts list (merge/split, manual captions, 409 concurrency,
  version-stamp machinery, safe-area toggle, Bold template, queuePosition,
  smart-crop reuse) + KEEP list confirming the hardening law items.

### Internal

- Smart Crop law + plan: `docs/solutions/architecture-patterns/smart-crop-three-app-decomposition-20260610.md`, `docs/plans/2026-06-09-002-feat-smart-crop-plan.md`
- Worker skeleton: `apps/crop-worker/src/*` + CLAUDE.md; client `apps/manager/src/services/crop-worker.ts`
- Job contracts: `apps/manager/src/types/job.ts`, `src/workflows/smartCrop.ts`, `src/lib/workflow-steps.ts`, `src/lib/job-artifacts.ts`
- Actor-derived audit precedent: `apps/manager/src/app/api/smart-crop/jobs/[id]/approve/route.ts:102`
- Mux: `apps/manager/src/services/mux.ts`; storage presign: `src/services/storage.ts`
- Transcription precedent (cue-level, words discarded): `apps/manager/src/services/elevenlabs-transcription.ts:13-19`
- Picker data: `apps/manager/src/app/api/videos/route.ts` + `src/lib/admin-video-lookup.ts`
- Deploy learnings: railpack-deploy-apt-packages, required-env-var-without-default, railway-dashboard-override-shadows-railway-toml, admin-manager-enrichment-trigger-endpoint, optional-railway-s3-local-fallback, railway-logsv2, aws-s3-nosuchkey, mocked-shape-vs-real-contract, in-memory-slot-reservation, outbound-timeout-shorter-than-caller-budget, client-mirror-server-dedupe — `docs/solutions/`

### External (Remotion 4.x, researched 2026-06-11)

- SSR: remotion.dev/docs/ssr-node, /docs/renderer/render-media; bundler cannot run in Next.js (/docs/miscellaneous/nextjs)
- Docker: /docs/docker, /docs/miscellaneous/linux-dependencies, /docs/renderer/ensure-browser; never Alpine
- Captions: /docs/captions/create-tiktok-style-captions (`white-space: pre`, absolute-ms tokens), /docs/install-whisper-cpp/transcribe (16kHz WAV, tokenLevelTimestamps/dtw, large-v3-turbo ≥4.0.229)
- Waveform: /docs/use-windowed-audio-data (CORS-bound), /docs/visualize-audio
- Player: /docs/player/player, /docs/player/integration ('use client', lazyComponent, never mount <Composition>)
- Trimming: trimBefore/trimAfter (renamed 4.0.319); OffthreadVideo no-HLS → pre-trim; long-source pathology github.com/orgs/remotion-dev/discussions/3070; concurrency semantics issues/4300
- License: github.com/remotion-dev/remotion/blob/main/LICENSE.md (non-profit free)
- Conventions: opus.pro caption best practices (3–7 words/page, 1–3s), kreatli.com safe zones, Montserrat/bold consensus
- Mux: instant clips are HLS-only (not render input); static renditions unnecessary here
