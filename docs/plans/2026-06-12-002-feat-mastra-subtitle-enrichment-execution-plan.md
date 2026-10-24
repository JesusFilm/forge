---
title: "Mastra subtitle enrichment execution"
type: feat
status: completed
date: 2026-06-12
origin: docs/roadmap/media-generation/feat-184-mastra-subtitle-enrichment-execution.md
---

# Mastra Subtitle Enrichment Execution

## Summary

Move the real subtitle translation/retiming work out of Manager and into
Mastra while preserving the current Manager user and job model. Manager remains
the operator control plane: it creates jobs, updates job step state, stores the
canonical job artifacts manifest, and runs the existing Mux subtitle sync.
Mastra becomes the runtime that reads the transcript artifact, chunks source
segments, calls OpenRouter for translation and retiming, writes the generated
subtitle artifacts back to the shared artifact store, and returns a
Manager-compatible language result envelope.

This is a clean current-main implementation. PR #886 and PR #1087 are reference
material only: #886 proves a route/client shape but was prototype-only, while
#1087 proves run-fencing ideas for broader enrichment handoff. Neither branch
should be merged wholesale.

## Problem Frame

`apps/manager/src/workflows/videoEnrichment.ts` still calls
`translateSubtitles()` from `apps/manager/src/services/subtitleTranslation`.
That keeps provider-heavy subtitle execution in Manager even though Mastra now
owns Forge AI workflow execution and already exposes service-bearer-protected
routes for transcript/scene/experience workflows. The migration should make the
existing `translation` step call Mastra without changing the Manager-visible job
shape or the downstream `syncTranslatedSubtitlesToMux()` contract.

## Requirements

- Manager's `translation` step calls Mastra for subtitle enrichment instead of
  importing `apps/manager/src/services/subtitleTranslation`.
- Mastra exposes a service route such as `POST /forge-subtitle-enrichment`
  guarded by `MASTRA_SERVICE_API_KEYS`.
- Mastra workflow input accepts `assetId`, `sourceLanguage`, `targetLanguages`,
  and transcript artifact metadata needed to read `{assetId}/transcript.json`.
- Mastra reads and writes the same artifact storage contract Manager already
  uses: `{assetId}/transcript.json`, `{assetId}/subtitles-{lang}.vtt`, and
  `{assetId}/translation-{lang}.json`.
- Mastra returns per-language results compatible with Manager's current
  `LanguageResult` type so `videoEnrichment.ts` and `mux-sync` do not need a
  new data model.
- Same-language subtitle requests remain no-op artifact copies with
  `mode: "source_equals_target"` and `translated: false`.
- Provider errors remain per-language where possible. If every requested target
  language fails, Manager's translation step fails as it does today.
- The route response distinguishes config/auth/network/contract failures from
  per-language workflow failures so Manager can choose retryable error messages.

## Scope Boundaries

In scope:

- Mastra-owned subtitle chunking, translation, retiming, VTT assembly, and
  translation JSON artifact writes.
- Shared artifact storage client inside `apps/mastra`, configured with the
  Railway S3-compatible env already used by Manager.
- Manager client wrapper plus `videoEnrichment.ts` translation step migration.
- Focused unit tests and contract tests across Manager and Mastra.
- Env docs for Manager caller timeout and Mastra provider/storage ownership.

Out of scope:

- Moving Manager job creation, operator UI, job persistence, or Mux subtitle
  sync into Mastra.
- Moving the entire `runVideoEnrichment` graph to Mastra.
- Adding callback/event ingestion for this synchronous first slice.
- Changing Admin GraphQL or generated typed-client artifacts.
- Changing Watch subtitle playback behavior.

## Current Patterns To Follow

- `apps/manager/src/services/mastra-transcript-embeddings.ts` for Manager
  service-route client parsing, auth failure mapping, timeout handling, and
  result envelope validation.
- `apps/mastra/src/mastra/workflows/transcript-embedding.ts` for
  service-bearer route handler shape and workflow launch result envelopes.
- `apps/mastra/src/mastra/index.ts` for route registration and workflow export.
- `apps/manager/src/services/subtitleTranslation/` for the behavior being
  migrated: chunking, translation prompt, retiming validation/fallback,
  no-op same-language artifacts, and artifact key shape.
- `apps/manager/src/services/storage.ts` for the exact artifact key validator
  and Railway S3/local fallback behavior to mirror in Mastra.
- `apps/manager/src/services/mux-sync/index.ts` for the downstream language
  result and artifact expectations.

## Design Decisions

1. **Synchronous Manager-to-Mastra call for this PR.** The existing Manager
   translation step already waits for `translateSubtitles()`, and the Mastra
   transcript/smart-crop service route clients already use bounded HTTP calls.
   Keeping subtitle enrichment synchronous avoids resurrecting stale callback
   machinery before the first real execution path ships.

2. **Mastra writes artifacts directly.** Returning full VTT bodies to Manager
   would keep artifact ownership in Manager and weaken the migration. Giving
   Mastra the same Railway S3 artifact access lets the AI workflow own its
   runtime outputs while preserving Manager artifact keys.

3. **Manager keeps Mux sync.** `syncTranslatedSubtitlesToMux()` is already
   coupled to Manager job ids, artifact download URLs, override audit state,
   and job detail behavior. Moving that in the same PR would conflate the AI
   runtime migration with operator publication semantics.

4. **Copy/extract behavior locally, no cross-app imports.** Mastra must not
   import `apps/manager`. The portable subtitle primitives should be recreated
   under `apps/mastra/src/services/subtitle-enrichment/` with local tests.

5. **Feature flag is not required for this narrow slice.** Manager already
   treats Mastra transcript embeddings as a required step when configured. The
   subtitle client should fail clearly with `config_missing` if Mastra is not
   configured; environments that run Manager enrichment need the new Mastra env
   and shared artifact env deployed together.

## Implementation Units

### Unit 1 - Mastra Subtitle Runtime Primitives

Files:

- Create: `apps/mastra/src/services/subtitle-enrichment/types.ts`
- Create: `apps/mastra/src/services/subtitle-enrichment/chunker.ts`
- Create: `apps/mastra/src/services/subtitle-enrichment/translator.ts`
- Create: `apps/mastra/src/services/subtitle-enrichment/retimer.ts`
- Create: `apps/mastra/src/services/subtitle-enrichment/storage.ts`
- Create: `apps/mastra/src/services/subtitle-enrichment/run.ts`
- Create tests beside the new services.
- Modify: `apps/mastra/src/config/env.ts`
- Modify: `apps/mastra/.env.example`
- Modify: `apps/mastra/CLAUDE.md`

Approach:

- Port the current Manager subtitle chunking and retiming behavior into Mastra
  with local types and schemas.
- Add an OpenRouter chat helper for subtitle translation and structured retiming
  using `OPENROUTER_API_PAID_KEY ?? OPENROUTER_API_KEY`.
- Add local artifact storage with the same key validator and S3/local fallback
  behavior as Manager. Use the Railway S3 env names already deployed for
  Manager so the two services can share the artifact bucket.
- Add `SUBTITLE_ENRICHMENT_MODEL` and
  `SUBTITLE_ENRICHMENT_TIMEOUT_MS`/per-call defaults only where they add real
  runtime control.

Test scenarios:

- Chunking preserves all source segments and flushes at sentence/max-size
  boundaries.
- Retiming validation rejects overlaps, invalid windows, and overlong segments.
- Deterministic retiming fallback returns bounded segments for long text.
- Storage rejects unsafe `assetId`, `artifactType`, and extension values.
- Runtime returns one completed result with `subtitles-fr` and
  `translation-fr` artifact keys when provider calls succeed.
- Runtime writes no-op artifacts when source and target language match.
- Runtime returns failed per-language results without aborting other target
  languages.

### Unit 2 - Mastra Workflow And Service Route

Files:

- Create: `apps/mastra/src/mastra/workflows/subtitle-enrichment.ts`
- Create: `apps/mastra/src/mastra/workflows/subtitle-enrichment.test.ts`
- Modify: `apps/mastra/src/mastra/index.ts`
- Modify: `apps/mastra/src/config/env.test.ts`

Approach:

- Define a structured workflow input schema with `assetId`,
  `sourceLanguage`, `targetLanguages`, and optional `runMode`/metadata fields
  that are useful in Studio without making operator forms noisy.
- Register the workflow in `mastra.workflows`.
- Register `POST /forge-subtitle-enrichment` as the service route, protected by
  `MASTRA_SERVICE_API_KEYS`.
- Return an envelope shaped as `{ result: { ok, ... } }` so Manager parsing can
  mirror existing Mastra client behavior.

Test scenarios:

- Missing/wrong bearer returns 401 before reading the body.
- Invalid body returns an `invalid_input` failure.
- Successful route starts the workflow and returns `ok: true`.
- All-language failure returns `ok: false` with a non-retryable
  `all_languages_failed` reason and the per-language failures.
- Workflow id and route registration are stable.

### Unit 3 - Manager Client And Workflow Migration

Files:

- Create: `apps/manager/src/services/mastra-subtitle-enrichment.ts`
- Create: `apps/manager/src/services/mastra-subtitle-enrichment.test.ts`
- Modify: `apps/manager/src/workflows/videoEnrichment.ts`
- Modify: `apps/manager/src/workflows/videoEnrichment.test.ts`
- Modify: `apps/manager/src/config/env.ts`
- Modify: `apps/manager/CLAUDE.md`

Approach:

- Add a Manager client that posts to `/forge-subtitle-enrichment` with
  `MASTRA_SERVICE_API_KEY`, validates the Mastra envelope, and maps route or
  contract failures to a typed result.
- Replace `stepSubtitleTranslation()`'s dynamic import of
  `@/services/subtitleTranslation` with the new Mastra client.
- Keep `getTranslationArtifactManifest()`, step details, and Mux sync unchanged
  by returning current `LanguageResult[]`.
- Add `MASTRA_SUBTITLE_ENRICHMENT_TIMEOUT_MS` to Manager env with a default
  large enough for multi-language subtitle runs.

Test scenarios:

- Client returns `config_missing` when Mastra URL/key are absent.
- Client maps 401 to `auth_failed`.
- Client rejects malformed success envelopes as `parse_error`.
- Client returns `LanguageResult[]` for mixed completed/failed language results.
- `runVideoEnrichment()` calls the Mastra subtitle client instead of
  `translateSubtitles()`.
- A failed Mastra subtitle launch marks the `translation` step failed.
- Mux sync receives the Mastra-returned language results unchanged.

### Unit 4 - Documentation And Roadmap Closure

Files:

- Modify: `apps/manager/AGENTS.md` if the app-level role text needs to mention
  subtitle AI execution moving to Mastra.
- Modify: `apps/mastra/AGENTS.md` to add subtitle enrichment to the runtime
  ownership list.
- Modify: `docs/roadmap/media-generation/feat-184-mastra-subtitle-enrichment-execution.md`
  with a Resolution section.
- Modify: `docs/roadmap/README.md` to mark the ticket complete after
  verification.

Approach:

- Keep docs focused on ownership boundaries and env contracts, not PR history.
- Only mark `feat-184` complete after tests and smoke proof pass.

Test scenarios:

- Roadmap dependency edges remain bidirectional:
  `feat-184` depends on `feat-031` and `feat-129`, and both source tickets
  list `feat-184` under `blocks`.

## Validation Plan

Run the narrow suite first:

- `pnpm --filter @forge/mastra test -- subtitle-enrichment`
- `pnpm --filter @forge/manager test -- mastra-subtitle-enrichment videoEnrichment`

Then run CI-sensitive checks for touched packages:

- `pnpm --filter @forge/mastra typecheck`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/mastra lint`
- `pnpm --filter @forge/manager lint`

Browser proof:

- No primary UI changes are expected, but run a lightweight Manager job-detail
  or local route smoke if the workflow migration changes job detail behavior or
  visible step state. Otherwise record why browser proof is not applicable.

## Risks

- **Long multi-language runs may exceed HTTP budgets.** Keep this first PR
  compatible with current Manager's synchronous translation step, but make the
  timeout explicit and preserve per-language result boundaries. If production
  runs exceed the budget, the next PR should adopt #1087-style callback
  fencing.
- **Shared artifact storage env may be missing on Mastra.** Mastra must fail
  with a clear storage/config error rather than silently returning completed
  language results without artifacts.
- **Provider helper drift.** The Manager OpenRouter helper uses the OpenAI SDK
  while Mastra has some direct-fetch helpers. Keep the Mastra implementation
  local and tested rather than importing Manager code.
- **Mux sync assumes Manager artifact URLs.** Because artifact keys stay the
  same and Manager still builds artifact access URLs, this should remain
  compatible.

## Completion Criteria

- Manager no longer imports or calls
  `apps/manager/src/services/subtitleTranslation` from
  `videoEnrichment.ts`.
- Mastra owns the real subtitle translation/retiming/artifact-writing route.
- Existing Manager Mux sync consumes Mastra-returned language results.
- Focused Manager and Mastra tests pass.
- `feat-184` roadmap ticket is updated to complete with verification notes.

## Completion Notes

Completed on 2026-06-12.

- Added Mastra-owned subtitle chunking, translation, retiming, artifact
  storage, workflow, and `/forge-subtitle-enrichment` service route.
- Added the Manager Mastra subtitle client and moved the `translation` workflow
  step to call Mastra instead of importing Manager-local subtitle translation.
- Removed the old Manager-local subtitle translation service and language
  config after the workflow stopped importing it.
- Kept Manager as job-state and Mux subtitle sync owner.
- Added focused Manager and Mastra contract tests plus env/docs updates.
