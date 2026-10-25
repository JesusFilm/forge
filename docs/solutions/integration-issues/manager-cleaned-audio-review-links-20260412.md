---
title: "Manager cleaned audio review links and workflow hardening"
category: integration-issues
module: Manager
date: 2026-04-12
problem_type: integration_issue
component: service_object
symptoms:
  - "audio_cleanup was rejected by the CMS job-step contract"
  - "Coverage reporting used a stale local workflow-step list"
  - "Audio cleanup depended on mux_upload, so later sync failures could block artifact creation"
  - "ffmpeg extraction lacked a timeout/kill path and audio size cap"
  - "Browser smoke needed both original and cleaned audio review links to open playable audio"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - manager
  - audio
  - workflow
  - cms
  - graphql
  - ffmpeg
  - mux
  - elevenlabs
affected_components:
  - apps/cms/src/components/enrichment/job-step.json
  - apps/cms/schema.graphql
  - packages/graphql/src/graphql-env.d.ts
  - apps/manager/src/lib/workflow-steps.ts
  - apps/manager/src/features/coverage/coverage-report-model.ts
  - apps/manager/src/workflows/videoEnrichment.ts
  - apps/manager/src/services/audioCleanup.ts
  - apps/manager/src/app/api/jobs/[id]/artifacts/[artifact]/route.ts
related_docs:
  - docs/plans/2026-04-12-feat-manager-cleaned-audio-review-links-plan.md
  - docs/plans/2026-04-12-fix-cleaned-audio-review-blockers-plan.md
  - docs/roadmap/media-generation/feat-081-cleaned-audio-review-links.md
  - docs/solutions/cms/strapi-enrichment-job-content-type.md
  - docs/solutions/integration-issues/manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md
  - docs/solutions/platform/railpack-deploy-apt-packages.md
---

# Manager cleaned audio review links and workflow hardening

## Problem

The cleaned audio review feature added a manager job-detail comparison between the original extracted audio and the ElevenLabs-cleaned audio, but the first pass left the new `audio_cleanup` step only partially integrated.

Review surfaced five connected failures:

1. Strapi still rejected `audio_cleanup` because the `enrichment.job-step` component enum and generated GraphQL contract did not include it.
2. Coverage reporting had its own old workflow-step list, so step completeness ignored `mux_upload` and `audio_cleanup`.
3. Audio cleanup ran after `mux_upload`, so a later Mux sync failure could prevent useful review artifacts from being created.
4. Partial audio cleanup artifact persistence could still throw out of the optional cleanup path.
5. `ffmpeg` extraction from a Mux playback URL had no wall-clock timeout or kill path, and extracted audio was buffered without a hard size cap.

The user-facing symptom was simple: operators needed reliable links to both the original and cleaned audio so they could compare the tracks. The underlying problem crossed CMS schema, generated GraphQL types, manager workflow state, external media processing, storage artifact serving, and job-detail UI.

## Root Cause

This was an integration-contract and workflow-isolation problem, not just an audio service bug.

`audio_cleanup` became part of persisted job state before every boundary knew about it. The manager initial step inventory, Strapi component enum, generated GraphQL contract, coverage model, and job-detail UI all needed the same step semantics. Leaving any one of those stale made the feature unreliable.

The workflow issue was separate but related: audio review artifacts were treated like a late add-on after Mux synchronization. That made a useful optional review artifact depend on a later optional integration step, and it let cleanup failure handling leak into the core enrichment result.

The media-processing issue had the same shape as other long-running external calls in the repo: Node and child-process work should be explicitly bounded. A stalled source URL or a very large extracted audio payload should fail the cleanup step, not wedge the entire enrichment job.

## Solution

### Use one canonical persisted step inventory

`apps/manager/src/lib/workflow-steps.ts` now exports `FORGE_WORKFLOW_STEPS`, which includes:

```typescript
export const FORGE_WORKFLOW_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "audio_cleanup",
]
```

`buildInitialSteps()` derives from that array, and coverage reporting imports the same model instead of maintaining a second hardcoded step list. The regression tests check three boundaries together:

- manager persisted step list
- `apps/cms/src/components/enrichment/job-step.json`
- `packages/graphql/src/graphql-env.d.ts`

That means the next new persisted step has to be accepted by the CMS enum and generated GraphQL contract before manager tests pass.

### Regenerate the CMS and GraphQL contracts with `audio_cleanup`

The Strapi component enum now includes `audio_cleanup`, and generated outputs were updated in:

- `apps/cms/schema.graphql`
- `packages/graphql/src/graphql-env.d.ts`

This is the same pattern as other Strapi contract changes in the repo: schema changes and generated GraphQL contracts move in the same PR, and manager tests should catch drift.

### Run audio cleanup as an isolated artifact branch

`apps/manager/src/workflows/videoEnrichment.ts` now starts audio cleanup before the later Mux upload/sync step can fail. When a `playbackId` is already known from job creation, the workflow builds the Mux playback URL directly and avoids a second Mux lookup.

The cleanup branch:

- marks `audio_cleanup` running
- runs `runAudioCleanup()` from the Mux playback URL
- persists `original-audio` and `cleaned-audio` artifact entries when both are produced
- on provider or extraction failure, persists any partial audio artifact keys exposed by `AudioCleanupError`
- logs manifest/status update failures without failing the core enrichment job

This keeps audio review optional while still preserving any artifacts that were already written.

### Bound `ffmpeg` and provider-side resource use

`apps/manager/src/services/audioCleanup.ts` now has a timeout-aware command runner. `defaultRunCommand()` records a single settled state, clears the timer on success/failure, and kills the child process on timeout:

```typescript
if (timeoutMs !== undefined) {
  timeout = setTimeout(() => {
    finish(() => {
      child.kill("SIGKILL")
      reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`))
    })
  }, timeoutMs)
}
```

`extractSourceAudioFromVideoUrl()` passes a default 5 minute extraction timeout, while tests can override it. `runAudioCleanup()` also rejects extracted audio over `100 * 1024 * 1024` bytes before calling ElevenLabs. The ElevenLabs request itself keeps its own timeout path.

This is intentionally incremental rather than a full streaming rewrite: the app still buffers audio within the configured cap, but it no longer waits forever on a stalled source or sends an unbounded payload to the provider.

### Serve artifacts without an extra manual byte copy

The audio artifact route now returns a `Blob` from the stored `Uint8Array` with the same inline content headers instead of copying the bytes into a new `Uint8Array` first. It is still an in-memory response path, but it removes one unnecessary duplicate allocation for playback.

## Verification

The fix was verified with:

- `pnpm --filter @forge/manager test` — 44 files, 268 tests
- `pnpm --filter @forge/manager lint`
- `pnpm --filter @forge/manager typecheck`
- `pnpm --filter @forge/graphql generate`
- `pnpm --filter @forge/graphql typecheck`
- `pnpm --filter @forge/cms typecheck`
- `git diff --check`

The browser smoke rendered the real manager job-detail header against local audio artifacts, confirmed the `Audio review` section exposed both links, confirmed the `Audio Cleanup` step appeared in the step table, clicked the cleaned-audio link, and verified artifact routes returned `200` with `content-type: audio/mpeg`.

A focused kill-path sanity check also ran `extractSourceAudioFromVideoUrl()` against a local hanging HTTP server with a 100ms extraction timeout. It returned in about 109ms with the expected timeout error and left no lingering `ffmpeg` process.

## Prevention

1. Keep `FORGE_WORKFLOW_STEPS` as the only persisted manager workflow inventory. Do not add separate step arrays in UI reports or route helpers.
2. Any new persisted manager step must update the Strapi component enum, regenerate GraphQL output, and add or keep a drift test that compares the contracts.
3. Treat optional enrichment artifacts as independent branches when possible. A later optional integration failure should not block already useful review artifacts.
4. If an optional step can partially write artifacts, expose the partial artifact keys through a typed error and make the manifest persistence best-effort inside that optional step.
5. Bound external media processing with both time and size. Child processes need a wall-clock timeout and a kill path; provider uploads need a payload cap or streaming implementation.
6. Keep provider secrets optional only when the feature is intentionally disableable, and pair that with a deployment readiness check. In this case, `ELEVENLABS_API_KEY` can disable cleanup, but production rollout still needs a target-env secret check and deployed smoke.
7. For user-facing artifact links, verify both the component state and the real route response. A unit test that renders a link is not enough if the route returns the wrong media type or the browser cannot open it.

## Related References

- [Cleaned audio review links plan](../../plans/2026-04-12-feat-manager-cleaned-audio-review-links-plan.md)
- [Cleaned audio review blockers plan](../../plans/2026-04-12-fix-cleaned-audio-review-blockers-plan.md)
- [Cleaned audio review links roadmap ticket](../../roadmap/media-generation/feat-081-cleaned-audio-review-links.md)
- [Strapi enrichment job content type](../cms/strapi-enrichment-job-content-type.md)
- [Manager Mux subtitle override recovery](manager-mux-subtitle-override-recovery-non-destructive-replacement-20260410.md)
- [Railpack deploy apt packages](../platform/railpack-deploy-apt-packages.md)
- [VideoForge manager integration](../platform/videoforge-manager-integration.md)
