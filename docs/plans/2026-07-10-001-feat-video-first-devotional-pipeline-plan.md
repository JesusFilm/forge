# Video-first daily-devotional pipeline (Mastra)

Status: in-progress. Foundation and the service-bearer lifecycle are built +
tested; remaining production-readiness work is tracked below. Branch
`feat/daily-devotional-generator`.

> **Storage boundary superseded — 2026-07-31:**
> [`2026-07-31-001-feat-devotional-workspace-data-plane-plan.md`](./2026-07-31-001-feat-devotional-workspace-data-plane-plan.md)
> replaces this plan's local corpus, reusable cache, and JSON used-clips storage
> assumptions. Workspace `/inputs` is the authored-data authority, Postgres owns
> workflow state, and generated `/runs` plus `/_system` paths are never inputs;
> tracked fixtures are migration seeds only, not production fallbacks.

## Problem / goal

Restructure the daily-devotional generator so it is **video-first** and built
from **swappable sub-workflows**, per the owner's decisions:

- **Video-first order** — pick an UNUSED JESUS-film clip first (never repeat a
  clip), then derive scripture from the clip's Bible passage, then hook, then
  write. Avoids two devotionals landing on the same clip.
- **Swappable sub-workflows** — Source / Content / Produce / Approve / Publish
  as separate Mastra workflows composed into one parent, so a piece can change
  without touching the others. "As much as possible written in Mastra, not code."
- **Localization seams now, English-only content** — language is a parameter;
  localizing later swaps Content + re-runs Produce; the clip (Source) is untouched.
- **Audio = ElevenLabs** — voiceover (TTS) + music (library). Voice **rotates
  D → E → C**. Music is a **20-track pre-generated library** (mood-matched, reused).
- **Human approval on the FINISHED video** — pipeline renders both MP4 variants,
  then suspends for approval through the authenticated lifecycle API (the Mastra
  playground at `localhost:4111` remains a local development surface), then
  publishes. Auto safety-check on the text still runs BEFORE render so we don't
  render clearly-bad content.

## Owner-approved architecture exception — 2026-07-21

The owner explicitly approved this pipeline as a narrow exception to Forge's
default heavy AI+media decomposition rule. The durable control loop, approval
suspension, worker polling, retry state, and publish handoff remain in Mastra
rather than moving to a Manager JobRecord. The reason is product-specific:
Source / Content / Produce / Approve / Publish are intentionally swappable
Mastra sub-workflows, and finished-video review is performed through the
authenticated Mastra Gateway workflow surface.

A Manager-owned loop invoking the same Mastra sub-workflows was considered. It
would add a second durable run model and translate Mastra suspension/retry state
into Manager JobRecord state without changing the review experience. For this
single externally scheduled, one-run-per-day pipeline, the owner accepted that
duplication in exchange for the stricter invariants below. Revisit the decision
if this gains internal scheduling, parallel daily runs, more publishers/output
formats, or any need to scale Mastra beyond one replica.

This approval does **not** permit media execution in Mastra and is not precedent
for another pipeline. The exception requires:

1. Exactly one production Mastra replica with workflow state persisted in
   Postgres. The replica limit covers process-local lifecycle and used-clip
   serialization.
2. Authenticated and serialized lifecycle operations; canonical starts are
   idempotent per UTC date, and retries are idempotent per parent-run and variant
   identity. Native Mastra workflow mutations are denied for the legacy, parent,
   and devotional sub-workflow IDs; dedicated lifecycle routes are the only
   mutation surface.
3. Fresh `admin`/`editor` authorization for every human approval, bounded actor
   attribution in the durable result, and dedicated disjoint approval and
   read-only playback credential lanes.
4. Shorts Worker ownership of source download, ffmpeg, Chromium, Remotion,
   cancellation, video bytes, and private durable object storage. Every job and
   artifact route is authenticated with a Worker-only bearer; redirects and
   public object URLs are forbidden.
5. Opaque artifact references across the Mastra/Worker boundary, Range-capable
   authenticated playback through Mastra Gateway, and a worker deadline below
   Mastra's poll ceiling, enforced by the Worker environment schema.
6. Focused lifecycle tests plus a real-binary portrait/wide render smoke before
   release.

Approved scope is limited to the current canonical/compatibility routes, the
Source / Content / Produce / Approve / Publish boundary, portrait and wide MP4
outputs, one site-ingest publisher, and external scheduling. New formats,
publishers, schedulers, approval surfaces, or control-loop responsibilities need
renewed owner approval.

If any invariant is removed, immediately set
`DEVOTIONAL_NEW_RUNS_ENABLED=false`, disable external scheduling, retain
read-only status/playback plus approval/cancel long enough to drain or explicitly
cancel suspended runs, and restore the invariant or migrate the control loop to
Manager before enabling new starts or retries.

## Already built + tested (this session)

- `services/devotional/elevenlabs-voiceover.ts` (+test) — ElevenLabs TTS,
  best-effort typed result mirroring the old Azure `voiceover.ts`. Voice registry
  `DEVOTIONAL_VOICES` (male-d / male-e / female-c). Expressive settings.
- `services/devotional/elevenlabs-music.ts` (+test) — ElevenLabs Music,
  `MUSIC_MOODS` presets (peace/hope/lament/awe).
- `services/devotional/voice-rotation.ts` (+test) — `rotateVoice(sequence)` → D/E/C.
- `services/devotional/used-clips-ledger.ts` (+test) — `chooseChapter` (prefer
  never-used by index, else least-recently-used) + persisted atomic store at
  `<artifactRoot>/used-clips.json`.
- `services/devotional/music-library.ts` (+test) — manifest type + `pickTrack(manifest, mood, sequence)`.
- `apps/shorts-worker/scripts/generate-music-library.mjs` — generates the 20-track
  library to `devo/assets/music/` + `manifest.json`. (Run once; already run.)
- `config/env.ts` — `ELEVENLABS_API_KEY` (optional), `ELEVENLABS_VOICE_ID`,
  `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_MUSIC_MODEL`; `getElevenLabsConfig()`,
  `getDevotionalElevenVoiceId()`.

## Entry points — read these first

1. `apps/mastra/src/mastra/workflows/video-first-devotional.ts` — the canonical
   Source → Content → Produce → Approve → Publish workflow and sub-workflows.
2. `apps/mastra/src/services/devotional/types.ts` — `Devotional`, `Hook`,
   `ScriptureRef`, `VideoClip`, `DevotionalReport`, `VoiceoverInfo`.
3. `apps/mastra/src/services/devotional/jesus-film-passages.ts` — the complete
   61-chapter passage map and curated clip windows.
4. `apps/mastra/src/services/devotional/devotional-worker-client.ts` — bounded
   uploads, render submission/polling, cancellation, and opaque artifact refs.
5. `apps/mastra/src/services/devotional/artifacts.ts` — store (`writeReport`,
   `readReport`, `writeAudio`). The worker owns video bytes; Mastra carries only
   the opaque portrait/wide artifact references described below.
6. `apps/shorts-worker/src/devotional-render.ts` — source download, ffmpeg media
   preparation, one Remotion bundle, dual-aspect render, validation, and durable
   artifact writes.

## Implemented service-bearer lifecycle contract

Start, cancel, and retry service routes require a valid bearer from
`MASTRA_SERVICE_API_KEYS` and fail closed with `401`. Status accepts either that
service pool or the read-only `DEVOTIONAL_PLAYBACK_API_KEYS`; assets accept only
the playback lane. Resume accepts only `DEVOTIONAL_APPROVAL_API_KEYS`. Mastra
Gateway revalidates the current `admin`/`editor` access record, keeps the three
credential sets disjoint, and supplies actor subject/email/role from the signed
session rather than the request body. The canonical start route is
`POST /forge-daily-devotional`; `POST /forge-video-first-devotional` is a
compatibility alias wired to the same handler. Lifecycle operations remain on
the alias namespace:

`DEVOTIONAL_NEW_RUNS_ENABLED` defaults to `false` and must be explicitly enabled
only after the architecture attestation passes. Native Mastra workflow mutation
routes remain denied for all devotional workflow IDs, so Studio cannot bypass
this gate or the dedicated approval contract. Native read-only Studio paths
revalidate the current Gateway access record. Playback-lane status reads never
renew reservations; service-lane polling and resume own that mutation. Start,
cancel, and retry are intentionally service-automation controls rather than
human Gateway actions.

| Method | Route                                         | Contract                                                                                                                                                                         |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/forge-daily-devotional`                     | Canonical start. Accepts optional `date`, `chapterIndex`, `sequence`, `regenerate`, and `regenerateAudio`.                                                                       |
| `POST` | `/forge-video-first-devotional`               | Compatibility alias for the identical start operation. Do not build new callers against this start alias.                                                                        |
| `GET`  | `/forge-video-first-devotional/:runId`        | Returns the durable run status and, when suspended, the normalized approval payload. Polling a suspended run renews its clip reservation.                                        |
| `POST` | `/forge-video-first-devotional/:runId/resume` | Dedicated human-approval bearer plus current-role revalidation and durable actor attribution. Resumes only a suspended run with `{ approved, notes? }`; otherwise returns `409`. |
| `POST` | `/forge-video-first-devotional/:runId/cancel` | Cancels only a suspended run and releases its clip reservation; all other states return `409`.                                                                                   |
| `POST` | `/forge-video-first-devotional/:runId/retry`  | Retries only a terminal, unpublished run. Optional `{ regenerate, regenerateAudio }` defaults both flags to `false`; a published run is never retryable.                         |

Start is date-idempotent. The service resolves an omitted date to the current
UTC date and uses `daily-devotional-YYYYMMDD` as the run id. A second start for
that date returns the existing durable state with `existing: true`; it must not
launch a parallel workflow or reserve a second clip. Retry is the deliberate
exception: it creates one deterministic `<parent-run-id>-retry-<variant-hash>`
run for a terminal unpublished parent and reattaches duplicate requests to it.

The approval suspension payload exposes two opaque worker artifact references,
never local paths or worker URLs:

```ts
type DevotionalVideoArtifactRef = {
  assetId: string
  artifactType: "devotional-output-portrait-v1" | "devotional-output-wide-v1"
  ext: "mp4"
}
```

The payload fields are `portraitAsset` and `wideAsset`. The Shorts Worker owns
the corresponding bytes and path resolution; callers treat each reference as
an indivisible capability and must not construct filesystem paths from it.

## What to build

### 1. Catalog passage mapping (`jesus-film-passages.ts`) — DOCTRINALLY SENSITIVE

Map each of the 61 chapters → its canonical Gospel passage, e.g.
`{ index: 19, book: "Luke", passage: "Luke 8:22-25", also: ["Mark 4:35-41"] }`
("Jesus Calms the Storm"). All 61 are Gospel scenes (NT), so all pass the
NT/Gospels/Acts constraint. **Author carefully and have the owner review** — this
feeds scripture selection, which must not be wrong. Provide `passageForChapter(index)`.
Test: full coverage (61 entries), every ref well-formed per
`scripture-selector` `isWellFormedReference`.

### 2. Passage-anchored scripture (`scripture-selector.ts`)

Add `selectScriptureForPassage({ chapterTitle, passage, book, llm })`: ask the LLM
to choose a specific verse WITHIN the clip's passage and quote it. Keep the
existing hook-anchored `selectScripture` for back-compat. `needsCanonicalSource`
stays true until a canonical Bible source is wired (A5).

### 3. Hook, reordered + theme-constrained

Hook becomes the timely framing that connects the clip's passage to today. Reuse
`hook-picker` but pass the chapter theme + scripture so the news/holiday/question
angle resonates with the clip (don't drift to an unrelated topic). Order:
clip → scripture → hook → write.

### 4. Produce workflow — audio + render

- **Voiceover**: `rotateVoice(sequence)` → `generateElevenVoiceover({ devotional, voice })`.
  `sequence` = count of published devotionals (from the report store) so rotation
  is stable. Persist via `artifactStore.writeAudio`.
- **Music**: load `devo/assets/music/manifest.json`; `pickTrack(manifest, mood, sequence)`;
  stage the chosen mp3 beside the render manifest. Mood from the devotional tone
  (writer can emit a `mood: MusicMood`, default "peace").
- **Render**: Mastra submits an opaque render job. Shorts Worker owns source
  download and preparation, spawns the Remotion renderer, produces the portrait
  and wide MP4s, and returns only the two opaque artifact refs. Deterministic
  failure → surface, don't hang.

### 5. Human approval — Mastra suspend/resume

The approval step uses the verified @mastra/core 1.36 suspend/resume API. It
`suspend()`s with `portraitAsset`, `wideAsset`, title, reference, and a bounded
reflection preview, then resumes on `{ approved: boolean, notes?: string }`.
Publish only on `approved`. The service route validates both resume data and the
suspension payload before returning either to a caller.

### 6. Publish

Reuse `publishDevotional` (best-effort). Record the two video artifact refs +
voiceover + music track in the report. A missing publish configuration is a
successful workflow outcome with `status: "publish_skipped"`, not a published
run and not a workflow crash. Call `usedClipsStore.record(chapterId,
reservationId)` only after the site confirms a successful publish. Approval by
itself is insufficient: `publish_skipped`, rejected, blocked, and failed runs
must not burn the clip and must leave it available after reservation release.

### 7. Compose the parent workflow + register

Parent `videoFirstDevotionalWorkflow` = Source → Content → Produce → Approve →
Publish sub-workflows, `.then()`-chained. Register it in
`apps/mastra/src/mastra/index.ts` behind the service-bearer lifecycle above. New
callers use canonical `POST /forge-daily-devotional`; the video-first name is a
compatibility alias, not a second workflow identity.

## Open decisions to confirm with owner

- **Passage mapping review** — owner reviews the 61-passage table before it ships
  (scripture accuracy).
- **Mood source** — does the writer LLM pick the music mood, or default "peace"?
- **Render output retention** — retention policy for the worker-owned portrait
  and wide artifacts; their API representation is already resolved as opaque
  refs, never Desktop/local paths.
- **Keep or retire Azure `voiceover.ts`** once ElevenLabs is wired in.
- **`sequence` source** — published-report count vs a dedicated counter in the ledger.

## Constraints

- Pure core + thin Mastra wrapper (match `runDailyDevotional`).
- Best-effort audio/publish: missing audio configuration remains skippable;
  missing site-publish configuration returns `publish_skipped`. Neither case may
  be represented as a successful publish.
- Clip usage is committed only after the site confirms publish success. Approval
  or render success alone must never call the used-clips record operation.
- One canonical run per UTC date. Repeated starts return the durable existing
  state; only the explicit terminal-run retry operation creates another run id.
- Mastra and API callers exchange opaque portrait/wide artifact refs. Worker
  filesystem paths and direct artifact URLs never cross the lifecycle contract.
- No clip reuse until the pool is exhausted (ledger policy).
- English-only content; language stays a parameter (no hardcoded "en" scattered).
- Never render before the text safety gate passes.

## Verification

- `pnpm --filter @forge/mastra exec vitest run src/services/devotional` green.
- `pnpm --filter @forge/mastra exec tsc --noEmit` clean.
- Playground (`pnpm --filter @forge/mastra dev` → localhost:4111): run the parent
  workflow, confirm it suspends with both opaque artifact refs, then resume
  approved → publishes.
- Route contract: authenticated canonical start and alias start return the same
  date-derived run; the second call has `existing: true`. Exercise status,
  resume, cancel, and retry including their `404`/`409` guards.
- End-to-end: produced MP4 uses the rotated voice + a library music track; the
  used-clips ledger advances only after confirmed publish; a `publish_skipped`
  run does not advance it.

### Architecture exception release attestation

The deploy DRI must attach evidence for every row. Static rows must pass before
temporarily enabling new runs for the controlled canary, while the external
scheduler remains off. A missing or failed row requires the flag to return to
`false` and blocks continued enablement even when part of the canary is green.

| Invariant                       | Release-blocking check and evidence                                                                                                                                                               | Revalidate when                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| One Mastra replica + Postgres   | Railway dashboard shows `numReplicas = 1`; runtime readiness identifies Postgres, and two same-date starts return one run/reservation.                                                            | Mastra scaling or storage configuration changes           |
| Serialized/idempotent lifecycle | Focused concurrency tests pass and canary repeats canonical + alias starts and retry variants.                                                                                                    | Lifecycle route or persistence changes                    |
| Least-privilege human lanes     | Gateway/Mastra boot disjointness tests pass; anonymous, wrong-lane, revoked-user, and missing-actor approval/playback requests fail closed; published result records actor subject/role.          | Gateway access or credential changes                      |
| Worker trust and byte boundary  | Anonymous job/cancel/input/artifact calls and anonymous bucket reads fail closed; lifecycle payload contains opaque refs only; Worker credentials are bucket-scoped.                              | Worker networking, auth, or bucket policy changes         |
| Deadline ordering               | Record Mastra's 4800000ms poll ceiling and Worker timeout at or below 4740000ms; Worker rejects 4740001ms at boot parsing, preserving 60s for cleanup, persistence, polling, and request latency. | Either timeout changes                                    |
| Real media proof                | Real-binary dual-aspect smoke produces readable MP4s and authenticated Range playback succeeds for both.                                                                                          | ffmpeg, Chromium, Remotion, image, or composition changes |

## Post-Deploy Monitoring & Validation

### Terms and ownership

- **Owner / DRI:** the engineer deploying the Mastra devotional change owns the
  full validation window and records links to the run ids, route responses,
  Railway logs, worker artifacts, site-ingest result, and ledger evidence in the
  deployment handoff. Do not hand off an unexplained active alert. Escalate
  render/artifact faults to the Shorts Worker owner and publish faults to the
  Watch ingest owner; the Mastra deployer remains accountable for closure.
- **Window:** begin at deploy completion and monitor for 24 hours **and** through
  at least one approved publish, whichever is longer. Check immediately after
  deploy, after start reaches suspension, after resume reaches a terminal state,
  at +1 hour, and after the next UTC-date start. If no approved publish completes
  in 24 hours, extend monitoring until one does; absence of traffic is not proof.
- **Canary terms:** initiate one controlled date through canonical
  `POST /forge-daily-devotional` only after static attestation passes; set
  `DEVOTIONAL_NEW_RUNS_ENABLED=true` for this canary while external scheduling
  remains disabled. Before approval, repeat start through both the canonical
  route and alias to prove date idempotency. Do not enable unattended scheduling
  until the canary reaches a known terminal state and every invariant below is
  accounted for. Return the flag to `false` on any failure.
- **Exception revocation:** on any failed invariant, set
  `DEVOTIONAL_NEW_RUNS_ENABLED=false` and stop the external scheduler first.
  Keep status/playback available. Drain approval-ready work only when its inputs
  and security boundaries remain trustworthy; otherwise cancel it and verify
  reservation release. Restore the invariant or migrate to Manager before the
  flag or scheduler is re-enabled.

### Signals and gates

| Signal                        | Healthy gate                                                                                                                                                                                      | Investigate / stop condition                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Service auth and route health | Authorized lifecycle calls have zero unexpected `401`, `5xx`, malformed JSON, or schema-invalid payloads.                                                                                         | Any authorized `401`, any route `5xx`, or any response that exposes a worker/local path.                                                  |
| Date idempotency              | Canonical start and alias start for one UTC date return the same `daily-devotional-YYYYMMDD`; repeats report `existing: true`.                                                                    | More than one non-retry run id or more than one clip reservation for a date. Halt new starts.                                             |
| Run progression               | Start reaches `suspended`/terminal; status polls agree with durable state; resume/cancel/retry return only their documented `200`/`202` or expected `404`/`409`.                                  | A non-suspended run is unchanged for 15 minutes, status regresses, or an illegal transition succeeds.                                     |
| Approval payload              | 100% of suspended runs contain valid `portraitAsset` and `wideAsset` refs with distinct artifact types and `ext: "mp4"`; both resolve through the worker-owned artifact path.                     | Missing/invalid ref, direct URL/path leakage, artifact not found, or unreadable/non-MP4 bytes.                                            |
| Publish semantics             | Approved + site-confirmed runs end `published`; publish config absence ends `publish_skipped`; both outcomes are visible in status/result.                                                        | Config absence crashes/fails the workflow, or any ambiguous ingest response is treated as published.                                      |
| Ledger coupling               | `clipRecorded`/used-clips history advances exactly once and only for a site-confirmed `published` result. `publish_skipped`, blocked, rejected, canceled, and failed runs do not record the clip. | Any ledger/result mismatch. Stop scheduling immediately because clip uniqueness is no longer trustworthy.                                 |
| Retry isolation               | Retry is rejected for published runs and creates one opaque-suffixed run id only for terminal unpublished runs.                                                                                   | Published run retries, retry reuses the original run id, or retry creates duplicate reservations without releasing/owning them correctly. |
| Exception attestation         | Every architecture-exception row above has current evidence and `DEVOTIONAL_NEW_RUNS_ENABLED` matches the recorded decision.                                                                      | Missing/stale evidence or any invariant failure. Disable new runs and scheduling immediately.                                             |

The rollout is validated only when the canary proves the full
start → suspend → approve → publish → ledger sequence, the repeated-start check
proves date idempotency, and the next UTC-date start selects a different eligible
clip. Component tests or a rendered MP4 alone do not satisfy this gate.
