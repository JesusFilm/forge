---
title: "feat: Add initial voiceover TTS service to manager enrichment"
type: feat
status: active
date: 2026-04-22
deepened: 2026-04-23
roadmap:
  - /docs/roadmap/media-generation/feat-014-voiceover-tts-service.md
---

# feat: Add initial voiceover TTS service to manager enrichment

## Overview

Implement the first shippable voiceover slice for `feat-014` inside
`apps/manager`: optionally generate full-length MP3 voiceovers from the source
transcript and any successful translated full-text artifacts, persist them as
job artifacts, and track the work as a real `voiceover` workflow step.

This plan intentionally narrows a broader stale branch attempt. V1 is
single-provider, artifact-first, and manager-only:

- one provider: ElevenLabs
- no voice-selection UI
- no multi-provider rerun flow
- no CMS publishable audio model yet

## Problem Statement

The current planning snapshot has three conflicting truths:

1. The roadmap ticket and manager types already imply a `voiceover` capability.
2. The live manager workflow does not actually create or persist a `voiceover`
   step.
3. A stale non-canonical branch (`origin/feat/ai-voiceover-multi-provider`)
   contains a much broader attempt that no longer matches the current ticket
   boundaries or manager architecture.

That leaves the repo with visible but misleading affordances:

- `WorkflowStepName` includes `voiceover`
- `JobOptions` includes `generateVoiceover`
- the new-job form exposes a `Generate voiceover` checkbox
- the persisted CMS job-step enum still omits `voiceover`
- the create-job API and workflow ignore the checkbox today

The goal of this slice is to turn voiceover from a placeholder into a truthful,
optional workflow step without reopening the broader product questions around
provider choice, editor review, or publishable CMS audio surfaces.

## Historical Context

The stale March branch is still useful as reference material, but it is too
broad to revive as-is.

Keep from the stale work:

- direct ElevenLabs fetch integration instead of forcing OpenRouter into TTS
- sentence-aware chunking and reuse of `translation-<lang>.json`
- artifact naming as `voiceover-<lang>.mp3`

Do not carry forward from the stale work:

- multi-provider adapter abstractions
- provider/voice overrides in the public API
- draft `VideoVariant` creation
- rerun-provider UI and concurrency controls

Those are follow-up concerns, not V1 requirements for `feat-014`.

## Research Decision

The first planning pass was directionally right, but this topic does benefit
from targeted deepening because it combines:

- a third-party API integration
- manager/CMS contract changes
- user-visible workflow truth in the job UI
- a checkout that is materially older than the richer stale branch used as
  historical reference

This deepening pass used:

- current-checkout repo evidence for manager/CMS/state/UI reality
- the stale voiceover branch only as historical context, not as source of truth
- official ElevenLabs documentation for request shape, continuity controls,
  model tradeoffs, and output-format constraints

## Current State Research

### Workflow and job-contract drift

- `apps/manager/src/types/job.ts`
  already includes `voiceover` in `WorkflowStepName` and
  `generateVoiceover` in `JobOptions`.
- `apps/manager/src/lib/workflow-steps.ts`
  does not include `voiceover` in `FORGE_WORKFLOW_STEPS`, so newly created jobs
  never persist a `voiceover` step.
- `apps/cms/src/components/enrichment/job-step.json`
  also omits `voiceover`, so manager cannot start persisting the step until the
  CMS component enum and generated GraphQL contract are updated together.

### Create-job contract drift

- `apps/manager/src/app/api/jobs/route.ts`
  accepts `inputUrl`, `language`, and `translateTo`, but no voiceover flag.
- `apps/manager/src/app/dashboard/jobs/new-job-form.tsx`
  still posts an older `{ muxAssetId, languages, options }` payload shape and
  already exposes a `Generate voiceover` checkbox that the API ignores.

V1 should not preserve two creation contracts. The canonical route contract
should remain the current `inputUrl`-based API and the form should be aligned to
that contract rather than reviving the stale shape.

### Text sources already exist

- `apps/manager/src/services/subtitleTranslation/index.ts`
  writes `translation-<lang>.json` artifacts with a full translated `text`
  field.
- `apps/manager/src/workflows/videoEnrichment.ts`
  already waits for translation to settle before later post-processing steps.

That means voiceover does not need to synthesize from VTT cues or rebuild text
from subtitle files. It can use:

- source language: `transcription.text`
- target languages: `translation-<lang>.json`

### Existing provider and storage patterns

- `apps/manager/src/config/env.ts`
  does **not** yet validate `ELEVENLABS_API_KEY`, so this slice must add an
  optional env entry and fail clearly only when voiceover is requested without
  credentials.
- this checkout does **not** contain
  `apps/manager/src/services/audioCleanup.ts` or
  `apps/manager/src/services/elevenlabs-transcription.ts`, so the plan cannot
  rely on existing ElevenLabs helper modules in the active branch.
- `apps/manager/src/services/storage.ts`
  already supports `writeArtifact({ assetId, artifactType, ext, body })`, which
  is sufficient for `voiceover-<lang>.mp3`.

### CMS persistence boundary

The roadmap ticket points at
`apps/cms/src/api/language-audio-preview/content-types/language-audio-preview/schema.json`,
but that model is language-global, not video-specific. It is the wrong v1 home
for per-video voiceover outputs.

`LanguageAudioPreview` may still matter for a later reusable language sample
surface, but it should not be used to represent enrichment-job output for a
specific video.

### Step detail and artifact contract reality

This checkout is materially thinner than the planning branch snapshot:

- `apps/cms/src/components/enrichment/job-step.json`
  has no `details` JSON field
- `apps/manager/src/types/job.ts`
  models `artifacts` as `Record<string, string>`
- `apps/manager/src/features/jobs/live-job-steps-table.tsx`
  currently expects one hard-coded `voiceover` artifact key, even though the
  useful output shape for this feature is per-language (`voiceover-en`,
  `voiceover-es`, etc.)

That means the plan must explicitly choose a persistence surface rather than
assuming richer per-step metadata already exists.

## Scope Boundaries

In scope:

- optional ElevenLabs-backed voiceover generation behind `generateVoiceover`
- source and translated full-text voiceover generation
- persisted `voiceover` workflow step in CMS and manager
- `voiceover-<lang>.mp3` artifact generation and job artifact tracking
- alignment of the create-job request path so the voiceover flag can actually be
  requested
- focused tests for service, workflow, and create-job wiring

Out of scope:

- multi-provider support
- provider or voice selection UI
- rerun-provider selection
- draft `VideoVariant` or `LanguageAudioPreview` writes
- lip sync, timing-aligned dubbing, or mux audio-track publishing
- audio cleanup / mixing beyond raw generated voiceover audio

## Requirements Trace

- **R1. Optional voiceover generation only when requested**
  Covered by Units 2, 3, and 5 through the `generateVoiceover` route flag,
  workflow gating, and explicit skipped-step behavior when disabled.
- **R2. Source language uses transcript; target languages use translated text**
  Covered by Unit 3 via `transcription.text` for the source language and
  `translation-<lang>.json` for successful target languages only.
- **R3. Persist generated audio as artifacts**
  Covered by Units 2 and 3 through `voiceover-<lang>.mp3` artifact generation
  plus job artifact manifest updates.
- **R4. Track voiceover in EnrichmentJob truthfully**
  Covered by Units 1, 3, and 5 through a real persisted `voiceover` step,
  artifact listing, and error-log behavior rather than placeholder UI copy.
- **R5. Single-provider, no voice-selection UI in v1**
  Covered by Key Decisions 1 and 5 plus Unit 2 service scope.
- **R6. Keep scope manager-only and defer publishable CMS audio models**
  Covered by Key Decision 2 and the explicit non-goal to avoid
  `LanguageAudioPreview` / `VideoVariant` writes in this slice.

## Key Decisions

### 1. One-provider V1: ElevenLabs only

Use ElevenLabs directly in manager for the initial slice.

Why:

- the repo already carries ElevenLabs credentials and working direct-fetch
  patterns
- the roadmap ticket explicitly says to choose one provider
- a provider abstraction without a second live provider would add complexity
  faster than it adds flexibility

Implementation consequence:

- create `apps/manager/src/services/voiceover.ts`
- keep provider-specific code inside that service for now
- defer `services/tts/*` abstraction unless a second provider becomes an active
  requirement

### 2. Artifact-first persistence, not CMS publish models

The first slice should stop at downloadable artifacts plus job-state reporting.

Why:

- the roadmap success criteria talk about artifacts and job tracking, not
  publishable CMS records
- the current CMS model called out by the ticket is not a good per-video fit
- adding publishable media records would force more product decisions than the
  ticket currently resolves

Implementation consequence:

- `voiceover-<lang>.mp3` artifacts become the canonical output
- step status and artifact manifest carry the user-visible state
- CMS content-model writes move to a follow-up ticket if needed

### 3. Run voiceover after translation settles

Voiceover should run after the current translation/chapters/metadata/embeddings
parallel block and before later optional review/sync stages.

Why:

- translated voiceover depends on `translation-<lang>.json`
- source-language voiceover depends only on transcription, but one shared
  post-translation phase keeps the implementation simpler and easier to reason
  about
- voiceover output is not a dependency for chapters, metadata, embeddings, or
  Mux subtitle sync

Implementation consequence:

- source language voiceover uses `transcription.text` and the resolved
  `transcription.language`
- translated voiceovers run only for languages whose translation artifact was
  successfully produced

### 4. Reuse translation-style per-language reporting

The first plan assumed `steps[].details.languageResults`, but this checkout does
not yet have step `details` in the CMS component or manager state model.

V1 should therefore persist truth through:

- one real `voiceover` workflow step status
- one artifact entry per generated file (`voiceover-en`, `voiceover-es`, etc.)
- the existing job `errors` log for failures

Implementation consequence:

- do **not** widen the job-step schema just for voiceover in this slice
- mark the step completed when all requested voiceover languages succeed
- mark the step failed when any requested language fails, while preserving
  successfully written artifacts and explicit error-log entries
- if richer per-language inline review becomes necessary later, add it as a
  follow-up ticket rather than hiding that scope here

This keeps the behavior honest while staying inside the existing persistence and
UI model of this checkout.

### 5. Align the form to the API, not the API to the stale form

The create-job API already reflects the current manager ingestion model
(`inputUrl` -> Mux asset creation -> enrichment run). Voiceover work should not
reintroduce the stale `muxAssetId`-driven creation contract from the old form.

Implementation consequence:

- extend the existing route schema with `generateVoiceover?: boolean`
- update the new-job form to submit the current canonical route payload
- remove or hide unsupported `uploadMux` / `notifyCms` toggles if they remain
  non-functional in the same surface

### 6. Use the regular ElevenLabs convert endpoint with a long-form quality bias

The manager enrichment workflow is asynchronous, offline work, not a real-time
agent surface. The v1 default should optimize for stable long-form narration,
not minimum latency.

Implementation consequence:

- use the regular `POST /v1/text-to-speech/:voice_id` convert endpoint
- default to `eleven_multilingual_v2` rather than a Flash model for better
  long-form stability
- request `mp3_44100_128` output so the stored artifacts are browser-friendly
  and consistent with the existing MP3 artifact expectation
- split long text into segments and pass `previous_text` / `next_text` for
  continuity across concatenated chunks

Streaming and websocket endpoints remain out of scope because they optimize
time-to-first-byte, not this background enrichment flow.

### 7. Keep the provider secret optional at startup but mandatory at execution

Because voiceover is optional, `ELEVENLABS_API_KEY` should remain optional in
environment validation. The service should throw a targeted runtime error only
when `generateVoiceover` is requested and the key is missing.

Implementation consequence:

- add `ELEVENLABS_API_KEY` as optional in `apps/manager/src/config/env.ts`
- validate it at the service boundary inside `voiceover.ts`
- surface a clear operator-facing error in job state rather than failing app
  startup for everyone

## Implementation Units

### Unit 1: Persist a real `voiceover` workflow step

Files:

- `apps/cms/src/components/enrichment/job-step.json`
- `packages/graphql/src/graphql-env.d.ts`
- `apps/manager/src/lib/workflow-steps.ts`
- `apps/manager/src/types/job.ts`
- `apps/manager/src/lib/state.ts`

Changes:

- add `voiceover` to the CMS component enum
- regenerate the GraphQL types touched by the enum change
- include `voiceover` in the persisted manager step list
- place it after `translation` in the persisted manager step order
- keep `JobRecord.artifacts` as the existing string-valued map in this slice;
  do not simultaneously widen both steps and artifact schemas unless execution
  proves it necessary

Tests / verification:

- manager can create a job without schema validation errors from the CMS step
  enum
- job summaries include a persisted `voiceover` step
- generated GraphQL types are regenerated, not hand-edited

### Unit 2: Add the dedicated voiceover service

Files:

- create `apps/manager/src/services/voiceover.ts`
- create `apps/manager/src/services/voiceover.test.ts`
- `apps/manager/src/config/env.ts`

Changes:

- implement an ElevenLabs-backed `generateVoiceover({ assetId, text, language })`
  function
- validate `ELEVENLABS_API_KEY` at call time, not app boot time
- default to the regular convert endpoint with `eleven_multilingual_v2`
  and `mp3_44100_128`
- split long input with `Intl.Segmenter`
- synthesize chunks sequentially to preserve continuity
- pass `previous_text` / `next_text` between adjacent chunks
- concatenate MP3 chunks safely and write
  `voiceover-<language>.mp3` through `writeArtifact`
- return a small result shape with artifact key plus generation metadata that is
  safe to persist in job details/artifacts if needed later
- map provider failures to clear manager errors without leaking secrets

Tests / verification:

- short single-chunk input writes one MP3 artifact
- long input produces multiple synthesis requests and one final artifact
- missing `ELEVENLABS_API_KEY` fails with a targeted configuration/runtime error
- provider error surfaces a stable message
- translated-language artifact names match `voiceover-<lang>.mp3`

### Unit 3: Wire voiceover into enrichment execution

Files:

- `apps/manager/src/workflows/videoEnrichment.ts`
- `apps/manager/src/workflows/videoEnrichment.test.ts`
- `apps/manager/src/lib/state.ts`

Changes:

- extend `VideoEnrichmentInput` with `generateVoiceover?: boolean`
- after the translation promise resolves, build the voiceover language list from:
  - resolved source language from the completed transcription result
  - successful translated languages only
- read `translation-<lang>.json` for translated text
- persist one job artifact entry per successful voiceover file
  (`voiceover-en`, `voiceover-es`, etc.)
- preserve successful artifact entries even when a later target language fails
- skip the step when `generateVoiceover` is false
- fail the overall step truthfully when any requested language fails, so the
  error log remains the operator-facing failure surface in this checkout

Tests / verification:

- `generateVoiceover: false` leaves the step skipped
- source + translated voiceovers run when enabled
- failed translated languages do not block successful voiceovers for other
  languages
- any failure marks the step failed and preserves any already-written artifacts

### Unit 4: Make job artifact presentation match the real output shape

Files:

- `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- any colocated tests for artifact presentation in the jobs UI

Changes:

- stop assuming one hard-coded `voiceover` artifact key
- present all `voiceover-*` artifacts for the voiceover step
- align translation artifact presentation the same way for `translation-*`
  outputs, since the current hard-coded `translations` key is already out of
  step with real artifact names

Tests / verification:

- the voiceover step shows all generated per-language artifacts
- the translation step still renders its per-language artifacts after the same
  helper change
- artifact rendering ignores unrelated artifact keys

### Unit 5: Align the create-job request path

Files:

- `apps/manager/src/app/api/jobs/route.ts`
- `apps/manager/src/app/dashboard/jobs/new-job-form.tsx`
- add or update route/form tests in the same area

Changes:

- extend the POST body schema with `generateVoiceover?: boolean`
- pass the flag through to `runVideoEnrichment(...)`
- update the form to submit the canonical `inputUrl`-based payload plus
  `generateVoiceover`
- do not expand the public API with provider or voice ids in this slice
- remove or hide the stale `uploadMux` / `notifyCms` controls from the form if
  they remain unsupported by the route contract

Tests / verification:

- POST `/api/jobs` accepts `generateVoiceover: true`
- the background workflow receives the flag
- the form submits the route-compatible payload shape
- unsupported legacy payload fields are no longer the primary UI path

## System-Wide Impact

- **CMS schema + generated GraphQL contract**
  Adding `voiceover` to the Strapi component enum requires the normal schema ->
  codegen -> manager contract flow. The plan should continue to treat
  `packages/graphql/src/graphql-env.d.ts` as generated output, never
  hand-edited.
- **Manager state read/write path**
  `updateStepStatus()` uses read-then-write replacement for the full `steps`
  array. Voiceover should reuse that existing boundary rather than inventing a
  second partial update path.
- **Job artifact contract**
  The current artifact store is a flat `Record<string, string>`. That makes
  per-language downloadable artifacts a better fit than introducing nested JSON
  summaries in the first slice.
- **Job detail UI**
  The step table currently assumes singular `translation` / `voiceover`
  artifact keys. Without the Unit 4 helper change, the feature could generate
  correct files but still appear broken to operators.
- **Operational runtime**
  The current workflow directives are inert without the workflow build plugin and
  API key. Voiceover will therefore run inside the same plain async
  `after()`-backed execution model as the rest of enrichment, increasing runtime
  but not changing the durability model in this slice.

## Verification Plan

Run focused manager validation for touched units:

```bash
pnpm --filter @forge/manager test -- src/services/voiceover.test.ts src/workflows/videoEnrichment.test.ts
pnpm --filter @forge/manager typecheck
pnpm --filter @forge/manager test -- src/app/api/jobs/route.test.ts
```

Manual behavior checks after implementation:

1. Start a job with `generateVoiceover: true`.
2. Confirm the persisted step list includes `voiceover`.
3. Confirm successful runs write `voiceover-<lang>.mp3` artifacts for the source
   language and each successfully translated target language.
4. Confirm the job detail step shows the generated per-language voiceover
   artifacts rather than a broken singular `voiceover` placeholder.
5. Confirm jobs without the flag leave `voiceover` skipped rather than pending.

## Risks and Mitigations

### Risk: long scripts exceed provider limits or cause choppy audio

Mitigation:

- sentence-aware chunking with `Intl.Segmenter`
- sequential synthesis with small continuity context between chunks
- choose the long-form-oriented convert flow and model rather than a low-latency
  streaming-first approach
- focused tests around chunk planning rather than only happy-path single chunk

### Risk: current checkout lacks the richer helper modules referenced by later work

Mitigation:

- treat this checkout, not the stale branch, as the implementation source of
  truth
- keep the service self-contained in `voiceover.ts`
- cite the stale branch only for historical ideas that still survive contact
  with the active repo

### Risk: the UI still looks broken even if artifacts are generated correctly

Mitigation:

- include the step-table artifact discovery change in the same slice
- validate the job detail view against real per-language artifact keys
- avoid introducing a singular `artifacts.voiceover` summary key that the UI
  might mistake for a downloadable file

### Risk: current form/API drift confuses implementation and QA

Mitigation:

- treat `apps/manager/src/app/api/jobs/route.ts` as the canonical contract
- make the form conform to that contract in the same slice
- avoid supporting both payload shapes

### Risk: voiceover stretches the current non-durable workflow runtime

Mitigation:

- keep the service idempotent at the artifact boundary so retries or reruns do
  not duplicate successful outputs
- fail with explicit errors when provider config is missing instead of silent
  no-ops
- treat durable workflow enablement or step-rerun support as a follow-up if
  runtime length becomes a real operational problem

### Risk: Strapi schema drift breaks manager after the enum change

Mitigation:

- update the Strapi component enum and regenerate GraphQL types in the same PR
- do not hand-edit generated gql.tada output
- verify job creation and job detail queries against the regenerated contract

### Risk: publishable CMS audio scope creeps into this ticket

Mitigation:

- keep output at the artifact/job-state boundary
- explicitly defer `LanguageAudioPreview` / `VideoVariant` publication to a
  later roadmap item

## Sources & References

Repo sources:

- `docs/roadmap/media-generation/feat-014-voiceover-tts-service.md`
- `apps/manager/src/workflows/videoEnrichment.ts`
- `apps/manager/src/lib/state.ts`
- `apps/manager/src/lib/workflow-steps.ts`
- `apps/manager/src/features/jobs/live-job-steps-table.tsx`
- `apps/manager/src/app/api/jobs/route.ts`
- `apps/manager/src/app/dashboard/jobs/new-job-form.tsx`
- `apps/manager/src/config/env.ts`
- `apps/manager/src/services/storage.ts`
- `apps/manager/src/services/translation.ts`
- `apps/cms/src/components/enrichment/job-step.json`
- `apps/cms/CLAUDE.md`
- `packages/graphql/CLAUDE.md`
- `docs/solutions/cms/strapi-enrichment-job-content-type.md`

Official external references:

- [ElevenLabs create speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [ElevenLabs text-to-speech overview](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)
- [ElevenLabs latency optimization guide](https://elevenlabs.io/docs/eleven-api/best-practices/latency-optimization)

## Next Phase

`ce:work` on this plan: implement Units 1-5 as one manager-scoped PR-sized
slice, starting with the CMS step-enum update and artifact/UI contract changes
so the service lands against truthful persisted job state instead of another
placeholder surface.
