---
id: "feat-178"
title: "Shorts Studio: vertical shorts with word-level captions via Remotion"
owner: "vlad"
priority: "P1"
status: "in-progress"
start_date: "2026-06-11"
duration: 10
depends_on: []
blocks: []
tags:
  - "manager"
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

Producing vertical (9:16) social cuts from library videos requires a video
editor per clip, so almost none get made. Admins need self-service: pick any
library video, scrub in/out points, get on-brand word-level "karaoke"
captions (whisper large-v3-turbo), tweak template/knobs with a live Remotion
preview, and render a 1080x1920 short delivered as a Mux asset plus a
downloadable MP4 — in minutes, durable and retryable, never re-paying
transcription.

## Entry Points — Read These First

1. `docs/plans/2026-06-11-002-feat-manager-shorts-studio-plan.md` — the
   authoritative architecture + wire contracts (artifact shapes, lifecycle
   contract, propsHash canonicalization, security/perf law items).
2. `apps/manager/src/workflows/shortsStudio.ts` — durable `runShortsPrepare`
   / `runShortsRender` workflows (single-writer for `ShortsPhase`,
   record-before-poll Mux output, provenance-checked artifact reuse).
3. `apps/manager/src/services/shorts-worker.ts` — submit+poll client
   (dedupe-key mirror, bounded `job_lost` resubmit, queue_full backoff, poll
   ceilings prepare 50min / render 80min).
4. `apps/manager/src/lib/` — `shorts-props.ts` (propsHash + render-props
   audit artifact), `shorts-draft.ts` (draftVersion + captionsGeneratedAt
   provenance), `shorts-report.ts` (phase metadata artifact),
   `shorts-artifacts.ts`, `whisper-language.ts` (BCP-47 → whisper map).
5. `apps/manager/src/app/api/shorts/` — routes: `jobs` (create/list),
   `videos/[coreId]` (eligibility), `jobs/[id]/{draft,render,retry}`,
   `jobs/[id]/media/[artifact]` (Range-capable streaming route).
6. `apps/manager/src/app/dashboard/shorts/` + `src/features/shorts/` —
   list / picker / detail UI, caption editor, `<Player>` preview wrapper
   (`short-preview.tsx`, dynamic ssr:false).
7. `apps/shorts-worker/src/` — prepare (`prepare.ts`: input-seek trim +
   whisper) and render (`render.ts`: baked bundle + loopback clip server)
   pipelines; `Dockerfile` + `railway.toml`; `apps/shorts-worker/CLAUDE.md`
   is the operating manual.
8. `packages/shorts-compositions/` — shared Remotion package; subpath
   exports `./schema ./captions ./registry` (pure) / `.` (Player) /
   `./entry` (worker bundle) / `./version`.

## Grep These

- `shorts_` / `shorts-` — all feature surfaces (steps, artifacts, routes)
- `shorts-clip-v1` / `shorts-captions-v1` / `shorts-output-v1` /
  `shorts-render-meta-v1` — artifact kind literals (cross-app contracts)
- `SHORTS_WORKER_` — worker env + manager↔worker auth pair
- `ShortsPhase` — lifecycle state machine + single-writer rule
- `propsHash` — render dedupe/reuse contract (manager computes, worker opaque)

## What To Build

BUILT through the manager UI (plan implemented end to end: compositions
package, shorts-worker app, manager workflows/routes/UI; host smoke passed).
Remaining work is deploy + validation:

1. Create the `shorts-worker` Railway service (Dockerfile builder; set the
   dashboard Config-as-code Path to `apps/shorts-worker/railway.toml` —
   silent-ignore precedent), keep replicas at 1, verify Railway honors
   `apps/shorts-worker/Dockerfile.dockerignore`.
2. Run the container smoke (`docker build` + in-container prepare→render) —
   the only proof that Chromium launches, fonts resolve, the whisper model
   loads, and the baked bundle resolves inside the image. Not yet executed.
3. Receiver-first key ordering: set `SHORTS_WORKER_API_KEYS` (distinct
   secret from `CROP_WORKER_API_KEYS`) + `RAILWAY_S3_*` on the worker,
   verify wrong bearer → 401 (not 503), THEN set manager's
   `SHORTS_WORKER_BASE_URL` + `SHORTS_WORKER_API_KEY`.
4. Production validation: real library video through picker → prepare →
   caption edit → render → Mux playback + streaming-route download.

## Constraints

- Zero admin schema changes: job state rides the existing JobRecord with the
  `options.shorts` discriminator + a `shorts` metadata artifact entry.
- Artifact keys stay flat `{assetId}/{artifactType}.{ext}` (storage
  validator `SAFE_KEY_PATTERN`).
- Worker enqueue-time deadlines stay STRICTLY below manager poll ceilings
  (prepare 45min < 50min, render 70min < 80min); raise pairs together.
- Manager server/workflow code imports ONLY `@forge/shorts-compositions/
{schema,captions,registry}` — never the root (Player) or `/entry`; the
  module-graph test pins schema/captions as React/Remotion-free.
- `remotion` / `@remotion/*` pinned EXACT (no `^`) across all three
  manifests — the version-lockstep test in the compositions package fails on
  drift (Remotion throws at render time on mismatch, in production Docker
  not CI).
- Worker SSRF: exact-host allowlist + https-only in production before any
  ffmpeg/ffprobe spawn; the S3 endpoint host is never allowlisted.

## Fast-follows

Explicitly deferred by the plan (recorded here, not regressions):

- Smart Crop source reuse at the picker (use an existing 9:16 smart-crop
  output as the shorts source).
- Merge/split caption editing with proportional timing redistribution
  (MVP editor = token text edit, token/page delete, captions on/off ONLY).
- Bold template as a registry preset (Focus + Frame ship in MVP).
- Manual caption authoring for unsupported-language / no-audio clips.
- AI highlight suggestions for in/out point selection.
- Container smoke wired into CI (currently a manual docker build + run).
- Queue lane sizing revisit (1 concurrent + queue limit 2 per lane) once
  real render volume exists.

## Verification

```bash
pnpm --filter @forge/shorts-compositions test && pnpm --filter @forge/shorts-compositions typecheck
pnpm --filter @forge/shorts-worker test && pnpm --filter @forge/shorts-worker typecheck && pnpm --filter @forge/shorts-worker build
pnpm --filter @forge/manager test && pnpm --filter @forge/manager typecheck && pnpm --filter @forge/manager lint && pnpm --filter @forge/manager build
pnpm --filter @forge/shorts-worker smoke   # host smoke: lavfi source -> prepare -> render -> ffprobe 1080x1920
# container smoke: docker build -f apps/shorts-worker/Dockerfile . + run the smoke inside the image
```

Deploy checklist: `apps/shorts-worker/CLAUDE.md` "Deploy checklist" section.
