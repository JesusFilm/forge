// Shorts Studio durable workflows (plan 2026-06-11-002 "Manager changes").
//
// runShortsPrepare: submit+poll the shorts-worker prepare lane (clip trim +
//   whisper word captions) -> seed the operator draft artifact -> report
//   phase "ready_for_review" -> job completed.
// runShortsRender: resolve final render props from the draft + clip meta
//   (audit artifact + propsHash) -> submit+poll the render lane -> Mux
//   output asset (record-before-poll, smart-crop pattern verbatim) -> report
//   phase "completed".
//
// Mirrors workflows/smartCrop.ts (the repo's law for step wrappers): "use
// workflow"/"use step" directives, dynamic imports inside step bodies, only
// scalars/ids across step boundaries, FatalError for deterministic failures
// (retryable:false envelopes, missing/invalid artifacts), workflow-level
// try/catch -> failJob + rethrow, defensive FatalError message reading.
//
// Single-writer rule (plan decision 2): these workflows own ALL ShortsPhase
// transitions. Routes only set launching intents. Failure phases are
// "prepare_failed" / "render_failed" depending on the workflow.

import { FatalError } from "workflow"
import {
  buildShortsMetadataArtifact,
  getShortsReport,
  mergeShortsReport,
  type ShortsReportPatch,
} from "@/lib/shorts-report"
import type {
  JobArtifactManifest,
  ShortsJobReport,
  WorkflowStepName,
} from "@/types/job"
import {
  stepMergeJobArtifacts,
  stepUpdateJob,
  stepUpdateStepStatus,
} from "@/workflows/jobStateSteps"

// Mux must download the rendered MP4 (up to ~360MB) from the presigned URL
// and encode it before status becomes "ready".
const MUX_OUTPUT_POLL_TIMEOUT_MS = 60 * 60_000
const MUX_OUTPUT_POLL_INTERVAL_MS = 10_000
// Presign TTL > Mux ingest window (plan decision 12). The presigned URL is
// never logged in full and never reaches any API/SSE payload.
const OUTPUT_PRESIGN_TTL_SECONDS = 7_200

const STORAGE_PRESIGN_UNAVAILABLE =
  "storage_presign_unavailable: artifact presigning requires RAILWAY_S3_* configuration"

export class ShortsStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ShortsStepError"
  }
}

// Maps a discriminated failure envelope (shorts-worker client) to the right
// throw: retryable:false means the failure is deterministic and the SDK must
// NOT retry the step (FatalError is detected by name), retryable:true
// failures keep the SDK's default retries. Messages already embed the reason
// code, so nothing downstream loses information.
function throwStepFailure(
  failure: { reason: string; retryable: boolean },
  message: string,
): never {
  if (!failure.retryable) {
    throw new FatalError(message)
  }
  throw new ShortsStepError(failure.reason, message)
}

// Defensive `.message` read (clone of workflows/smartCrop.ts errorMessage —
// duplicated rather than imported so the workflow build plugin never bundles
// one workflow file into another): the SDK's FatalError is NOT an
// `instanceof Error` in the Next.js workflow runtime; gating on instanceof
// would show "Unknown error" instead of the operator-actionable detail.
export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }
  return "Unknown error"
}

export type ShortsPrepareWorkflowInput = {
  jobId: string
  /** Re-runs the worker even when clip + captions artifacts already exist
   * (discards caption edits via the draft provenance reset). */
  force?: boolean
}

export type ShortsRenderWorkflowInput = {
  jobId: string
}

// ---------------------------------------------------------------------------
// Workflow-body helpers (plain async functions calling "use step" functions)
// ---------------------------------------------------------------------------

async function markStepRunning(jobId: string, step: WorkflowStepName) {
  await stepUpdateStepStatus(jobId, step, "running")
  await stepUpdateJob(jobId, { status: "running", currentStep: step })
}

async function markStepComplete(jobId: string, step: WorkflowStepName) {
  await stepUpdateStepStatus(jobId, step, "completed")
}

async function markStepSkipped(
  jobId: string,
  step: WorkflowStepName,
  note?: string,
) {
  // stepUpdateStepStatus already drops an undefined note — no branch needed.
  await stepUpdateStepStatus(jobId, step, "skipped", note)
}

async function markStepFailed(
  jobId: string,
  step: WorkflowStepName,
  error: string,
) {
  await stepUpdateStepStatus(jobId, step, "failed", error)
}

async function persistMergedArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<void> {
  if (Object.keys(artifacts).length === 0) {
    return
  }

  const updated = await stepMergeJobArtifacts(jobId, artifacts)
  if (!updated) {
    throw new Error(`Failed to persist artifact manifest for job ${jobId}`)
  }
}

// Wholesale report write — failJob's FALLBACK only. Main-path persists go
// through applyReportPatch so the merge happens against the CURRENT
// persisted entry inside the per-job state lock.
async function persistReport(
  jobId: string,
  report: ShortsJobReport,
): Promise<void> {
  await persistMergedArtifacts(jobId, buildShortsMetadataArtifact(report))
}

// Field-level report persist: the patch is merged onto the CURRENT persisted
// entry inside the per-job write lock (state.mergeShortsReportEntry), so a
// persist landing after a multi-minute step cannot clobber interim writes —
// e.g. the draft route's draftVersion mirror. Returns the patch layered onto
// the caller's local snapshot, which survives only as failJob's fallback.
async function applyReportPatch(
  jobId: string,
  snapshot: ShortsJobReport,
  patch: ShortsReportPatch,
): Promise<ShortsJobReport> {
  await stepMergeShortsReport(jobId, patch)
  return mergeShortsReport(snapshot, patch)
}

async function completeJob(jobId: string): Promise<void> {
  await stepUpdateJob(jobId, {
    status: "completed",
    currentStep: undefined,
    completedAt: new Date().toISOString(),
  })
  console.log(`[shorts] event=workflow_complete jobId=${jobId}`)
}

async function failJob(
  jobId: string,
  fallbackReport: ShortsJobReport,
  error: unknown,
  phase: "prepare_failed" | "render_failed",
): Promise<void> {
  const message = errorMessage(error)
  console.error(`[shorts] event=workflow_error jobId=${jobId} error=${message}`)

  try {
    // Patch ONLY the phase via the locked field-level merge: an early failure
    // (context/report read threw before the local snapshot hydrated) must not
    // wipe previously persisted fields — hasAudio/captionsCount/draftVersion/
    // output all survive, only phase (+updatedAt) moves.
    await stepMergeShortsReport(jobId, { phase })
  } catch (mergeError) {
    console.error(
      `[shorts] event=report_merge_failed jobId=${jobId} error=${errorMessage(mergeError)}`,
    )
    try {
      // Best-effort fallback when the locked re-read itself fails: persist
      // the failure phase from the local snapshot so the operator still sees
      // a terminal phase instead of a job stuck in a running one.
      await persistReport(jobId, mergeShortsReport(fallbackReport, { phase }))
    } catch (persistError) {
      console.error(
        `[shorts] event=report_persist_failed jobId=${jobId} error=${errorMessage(persistError)}`,
      )
    }
  }

  await stepUpdateJob(jobId, { status: "failed", currentStep: undefined })
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export async function runShortsPrepare(
  input: ShortsPrepareWorkflowInput,
): Promise<void> {
  "use workflow"

  console.log(
    `[shorts] event=workflow_start kind=prepare jobId=${input.jobId} force=${input.force ?? false}`,
  )

  await stepUpdateJob(input.jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  })

  // Local snapshot — used ONLY as failJob's fallback when the locked
  // field-level merge is unavailable; all main-path persists re-read the
  // persisted entry inside the state lock (applyReportPatch).
  let report = mergeShortsReport(null, { phase: "queued" })

  try {
    const ctx = await stepGetShortsContext(input.jobId)
    report = (await stepReadShortsReport(input.jobId)) ?? report

    await markStepRunning(input.jobId, "shorts_prepare")
    report = await applyReportPatch(input.jobId, report, {
      phase: "preparing",
    })

    let result: Awaited<ReturnType<typeof stepShortsPrepare>>
    try {
      result = await stepShortsPrepare({
        jobId: input.jobId,
        assetId: ctx.assetId,
        playbackId: ctx.sourcePlaybackId,
        clipStartSec: ctx.clipStartSec,
        clipEndSec: ctx.clipEndSec,
        whisperLanguage: ctx.whisperLanguage,
        force: input.force ?? false,
      })
    } catch (error) {
      await markStepFailed(input.jobId, "shorts_prepare", errorMessage(error))
      throw error
    }

    report = await applyReportPatch(input.jobId, report, {
      phase: "ready_for_review",
      hasAudio: result.hasAudio,
      clipDurationSec: result.clipDurationSec,
      captionsCount: result.captionsCount,
      annotation: result.annotation,
      draftVersion: result.draftVersion,
    })

    if (result.workerSkipped) {
      await markStepSkipped(
        input.jobId,
        "shorts_prepare",
        "reused existing clip + captions artifacts",
      )
    } else {
      await markStepComplete(input.jobId, "shorts_prepare")
    }

    // After PREPARE the workflow ends with job.status="completed" + phase
    // "ready_for_review" (plan decision 2) — the render is a separate launch.
    await completeJob(input.jobId)
  } catch (error) {
    await failJob(input.jobId, report, error, "prepare_failed")
    throw error
  }
}

export async function runShortsRender(
  input: ShortsRenderWorkflowInput,
): Promise<void> {
  "use workflow"

  console.log(`[shorts] event=workflow_start kind=render jobId=${input.jobId}`)

  await stepUpdateJob(input.jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  })

  // Local snapshot — failJob's fallback only (see runShortsPrepare).
  let report = mergeShortsReport(null, { phase: "rendering" })

  try {
    const ctx = await stepGetShortsContext(input.jobId)
    report = (await stepReadShortsReport(input.jobId)) ?? report

    await markStepRunning(input.jobId, "shorts_render")
    report = await applyReportPatch(input.jobId, report, {
      phase: "rendering",
    })

    // Resolve props + propsHash and write the audit artifact; only scalars
    // cross the step boundary. The submit step re-reads the audit artifact
    // (provenance-verified by propsHash) instead of recomputing from the
    // draft — the draft may move between steps, and the audit copy IS the
    // exact payload that must reach the worker.
    let resolved: Awaited<ReturnType<typeof stepShortsResolveRenderProps>>
    try {
      resolved = await stepShortsResolveRenderProps({
        jobId: input.jobId,
        assetId: ctx.assetId,
      })

      const submitted = await stepShortsSubmitRender({
        jobId: input.jobId,
        assetId: ctx.assetId,
        propsHash: resolved.propsHash,
        draftVersion: resolved.draftVersion,
      })

      if (submitted.workerSkipped) {
        await markStepSkipped(
          input.jobId,
          "shorts_render",
          "reused existing output for identical propsHash",
        )
      } else {
        await markStepComplete(input.jobId, "shorts_render")
      }
    } catch (error) {
      await markStepFailed(input.jobId, "shorts_render", errorMessage(error))
      throw error
    }

    await markStepRunning(input.jobId, "shorts_mux_output")
    report = await applyReportPatch(input.jobId, report, {
      phase: "mux_processing",
    })

    let mux: Awaited<ReturnType<typeof stepShortsMuxOutput>>
    try {
      mux = await stepShortsMuxOutput({
        jobId: input.jobId,
        assetId: ctx.assetId,
        propsHash: resolved.propsHash,
      })
    } catch (error) {
      await markStepFailed(
        input.jobId,
        "shorts_mux_output",
        errorMessage(error),
      )
      throw error
    }

    if (mux.outcome === "presign_unavailable") {
      // Local mode degradation: the render output exists in storage but no
      // Mux asset can be created — the job still completes with
      // output.ready=false (download stays available via the media route).
      report = await applyReportPatch(input.jobId, report, {
        phase: "completed",
        lastRenderedDraftVersion: resolved.draftVersion,
        lastRenderedPropsHash: resolved.propsHash,
        output: { muxAssetId: null, playbackId: null, ready: false },
      })
      await markStepSkipped(
        input.jobId,
        "shorts_mux_output",
        STORAGE_PRESIGN_UNAVAILABLE,
      )
    } else {
      report = await applyReportPatch(input.jobId, report, {
        phase: "completed",
        lastRenderedDraftVersion: resolved.draftVersion,
        lastRenderedPropsHash: resolved.propsHash,
        output: {
          muxAssetId: mux.muxAssetId,
          playbackId: mux.playbackId ?? null,
          ready: true,
        },
      })
      if (mux.outcome === "exists") {
        await markStepSkipped(input.jobId, "shorts_mux_output")
      } else {
        await markStepComplete(input.jobId, "shorts_mux_output")
      }
    }

    await completeJob(input.jobId)
  } catch (error) {
    await failJob(input.jobId, report, error, "render_failed")
    throw error
  }
}

// ---------------------------------------------------------------------------
// Steps ("use step" — dynamic imports of heavy services, small journaled
// args/results)
// ---------------------------------------------------------------------------

async function readJsonArtifact(
  assetId: string,
  artifactType: string,
): Promise<unknown> {
  const { readArtifact } = await import("@/services/storage")
  const bytes = await readArtifact(assetId, artifactType, "json")
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

// Throttled shorts-worker progress mirror into the job's step details.
// Best-effort: a state-write failure must never fail a long render. Plain
// function called from within "use step" bodies — imports stay dynamic.
// Reuses the generic threshold logic from the smart-crop service.
async function createStepProgressReporter(
  jobId: string,
  step: WorkflowStepName,
): Promise<
  (snapshot: {
    progress: number | null
    message: string | null
  }) => Promise<void>
> {
  const { updateStepStatus } = await import("@/lib/state")
  const { shouldEmitRenderProgress } = await import("@/services/smartCrop")

  let last: { progress: number | null; message: string | null } | null = null
  return async (snapshot) => {
    const next = { progress: snapshot.progress, message: snapshot.message }
    if (!shouldEmitRenderProgress(last, next)) {
      return
    }
    last = next
    try {
      await updateStepStatus(jobId, step, "running", undefined, {
        ...(next.progress !== null ? { progress: next.progress } : {}),
        ...(next.message !== null ? { message: next.message } : {}),
      })
    } catch {
      // Progress mirroring is best-effort.
    }
  }
}

// Reads the job's shorts context — only scalars cross the step boundary.
async function stepGetShortsContext(jobId: string): Promise<{
  assetId: string
  sourcePlaybackId: string
  clipStartSec: number
  clipEndSec: number
  whisperLanguage: string | null
}> {
  "use step"
  const { getJob } = await import("@/lib/state")

  const job = await getJob(jobId)
  if (!job) {
    throw new FatalError(`job_not_found: no job ${jobId}`)
  }
  const shorts = job.options.shorts
  if (!shorts) {
    throw new FatalError(
      `not_a_shorts_job: job ${jobId} has no options.shorts discriminator`,
    )
  }

  return {
    assetId: shorts.assetId,
    sourcePlaybackId: shorts.sourcePlaybackId,
    clipStartSec: shorts.clip.startSec,
    clipEndSec: shorts.clip.endSec,
    whisperLanguage: shorts.language.whisper,
  }
}

// Reads the persisted shorts report so a later workflow run (render after
// prepare) merges instead of clobbering prepare-written fields.
async function stepReadShortsReport(
  jobId: string,
): Promise<ShortsJobReport | null> {
  "use step"
  const { getJob } = await import("@/lib/state")

  const job = await getJob(jobId)
  return job ? getShortsReport(job.artifacts) : null
}

// Persists a field-level report patch through state.mergeShortsReportEntry —
// the current entry is re-read INSIDE the per-job write lock, so workflow
// persists are true read-modify-writes (no lost updates against the draft
// route's draftVersion mirror or any other interim writer).
async function stepMergeShortsReport(
  jobId: string,
  patch: ShortsReportPatch,
): Promise<void> {
  "use step"
  const { mergeShortsReportEntry } = await import("@/lib/state")

  const updated = await mergeShortsReportEntry(jobId, patch)
  if (!updated) {
    throw new Error(`Failed to persist shorts report for job ${jobId}`)
  }
}

async function stepShortsPrepare(args: {
  jobId: string
  assetId: string
  playbackId: string
  clipStartSec: number
  clipEndSec: number
  whisperLanguage: string | null
  force: boolean
}): Promise<{
  workerSkipped: boolean
  hasAudio: boolean
  clipDurationSec: number
  captionsCount: number
  annotation: string | null
  draftVersion: number
}> {
  "use step"
  const { artifactExists } = await import("@/services/storage")
  const shortsArtifacts = await import("@/lib/shorts-artifacts")

  const readClipMeta = async () =>
    shortsArtifacts.parseShortsClipMeta(
      await readJsonArtifact(
        args.assetId,
        shortsArtifacts.SHORTS_CLIP_META_ARTIFACT_TYPE,
      ).catch(() => null),
    )
  const readCaptions = async () =>
    shortsArtifacts.parseShortsCaptionsArtifact(
      await readJsonArtifact(
        args.assetId,
        shortsArtifacts.SHORTS_CAPTIONS_ARTIFACT_TYPE,
      ).catch(() => null),
    )

  // Reuse-not-rerun: the worker call is skipped only when the clip MP4 AND
  // both JSON artifacts already exist AND parse AND no force flag —
  // provenance-checked skip, never bare artifactExists.
  const clipExists = await artifactExists(
    args.assetId,
    shortsArtifacts.SHORTS_CLIP_ARTIFACT_TYPE,
    "mp4",
  )
  let clipMeta = clipExists ? await readClipMeta() : null
  let captions = clipExists ? await readCaptions() : null

  const workerSkipped = shortsArtifacts.shouldSkipPrepareWorker({
    force: args.force,
    clipExists,
    clipMeta,
    captions,
  })

  if (!workerSkipped) {
    const { runShortsWorkerJob, SHORTS_PREPARE_POLL_TIMEOUT_MS } =
      await import("@/services/shorts-worker")
    const { getPlaybackUrl } = await import("@/services/mux")

    const result = await runShortsWorkerJob({
      body: {
        kind: "prepare",
        jobId: args.jobId,
        assetId: args.assetId,
        source: { url: getPlaybackUrl(args.playbackId) },
        clip: { startSec: args.clipStartSec, endSec: args.clipEndSec },
        transcription: { language: args.whisperLanguage },
      },
      pollTimeoutMs: SHORTS_PREPARE_POLL_TIMEOUT_MS,
      onProgress: await createStepProgressReporter(
        args.jobId,
        "shorts_prepare",
      ),
    })

    if (!result.ok) {
      throwStepFailure(
        result,
        `shorts-worker prepare failed (${result.reason}): ${result.messages.join("; ")}`,
      )
    }

    clipMeta = await readClipMeta()
    captions = await readCaptions()
  }

  if (!clipMeta || !captions) {
    // The worker reported success (or the skip gate misfired) but the
    // artifacts are missing/malformed — deterministic, never auto-retry.
    throw new FatalError(
      `prepare_artifacts_invalid: clip meta or captions artifact for ${args.assetId} is missing or malformed after prepare`,
    )
  }

  // Seed/refresh the operator draft. A draft built against the CURRENT
  // captions artifact (matching captionsGeneratedAt provenance) is kept —
  // plain retries never discard caption edits. Regenerated captions (force
  // prepare) reset to the initial draft: the documented edit-discard path.
  const {
    buildInitialDraft,
    readShortsDraft,
    shouldResetDraft,
    writeShortsDraft,
  } = await import("@/lib/shorts-draft")

  // Null-check first so the kept-draft branch narrows without casts —
  // shouldResetDraft(null, ...) is always true, so the ordering is identical.
  const existingDraft = await readShortsDraft(args.assetId)
  let draftVersion: number
  if (existingDraft && !shouldResetDraft(existingDraft, captions.generatedAt)) {
    draftVersion = existingDraft.draftVersion
  } else {
    const initial = buildInitialDraft(captions.captions, captions.generatedAt)
    await writeShortsDraft(args.assetId, initial)
    draftVersion = initial.draftVersion
  }

  return {
    workerSkipped,
    hasAudio: clipMeta.hasAudio,
    clipDurationSec: clipMeta.durationSec,
    captionsCount: captions.captions.length,
    annotation: captions.annotation,
    draftVersion,
  }
}

async function stepShortsResolveRenderProps(args: {
  jobId: string
  assetId: string
}): Promise<{ propsHash: string; draftVersion: number }> {
  "use step"
  const { artifactExists, writeArtifact } = await import("@/services/storage")
  const shortsArtifacts = await import("@/lib/shorts-artifacts")
  const { readShortsDraft } = await import("@/lib/shorts-draft")
  const shortsProps = await import("@/lib/shorts-props")

  const draft = await readShortsDraft(args.assetId)
  if (!draft) {
    throw new FatalError(
      `draft_missing: no valid shorts draft artifact for ${args.assetId} — run prepare first`,
    )
  }

  const clipMetaExists = await artifactExists(
    args.assetId,
    shortsArtifacts.SHORTS_CLIP_META_ARTIFACT_TYPE,
    "json",
  )
  if (!clipMetaExists) {
    throw new FatalError(
      `clip_meta_missing: no shorts clip meta artifact for ${args.assetId} — run prepare first`,
    )
  }
  const clipMeta = shortsArtifacts.parseShortsClipMeta(
    await readJsonArtifact(
      args.assetId,
      shortsArtifacts.SHORTS_CLIP_META_ARTIFACT_TYPE,
    ).catch(() => null),
  )
  if (!clipMeta) {
    throw new FatalError(
      `clip_meta_invalid: shorts clip meta artifact for ${args.assetId} is malformed`,
    )
  }

  // Draft provenance gate: refuse to render caption pages built against a
  // captions artifact that has since been regenerated.
  const captions = shortsArtifacts.parseShortsCaptionsArtifact(
    await readJsonArtifact(
      args.assetId,
      shortsArtifacts.SHORTS_CAPTIONS_ARTIFACT_TYPE,
    ).catch(() => null),
  )
  if (!captions) {
    throw new FatalError(
      `captions_invalid: shorts captions artifact for ${args.assetId} is missing or malformed`,
    )
  }
  if (draft.captionsGeneratedAt !== captions.generatedAt) {
    throw new FatalError(
      `draft_provenance_mismatch: draft for ${args.assetId} was built against captions generated at ${draft.captionsGeneratedAt} but the current captions artifact is ${captions.generatedAt} — re-save the draft or force prepare`,
    )
  }

  let props: import("@/lib/shorts-props").ShortRenderProps
  try {
    props = shortsProps.resolveShortInputProps({ draft: draft.draft, clipMeta })
  } catch (error) {
    if (error instanceof shortsProps.ShortsPropsValidationError) {
      throw new FatalError(error.message)
    }
    throw error
  }

  const propsHash = shortsProps.computePropsHash(props, {
    assetId: args.assetId,
    artifactType: shortsArtifacts.SHORTS_CLIP_ARTIFACT_TYPE,
  })

  const audit = shortsProps.buildShortsRenderPropsArtifact({
    propsHash,
    draftVersion: draft.draftVersion,
    props,
  })
  await writeArtifact({
    assetId: args.assetId,
    artifactType: shortsArtifacts.SHORTS_RENDER_PROPS_ARTIFACT_TYPE,
    ext: "json",
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  })

  console.log(
    `[shorts] event=render_props_resolved jobId=${args.jobId} assetId=${args.assetId} propsHash=${propsHash} draftVersion=${draft.draftVersion}`,
  )

  return { propsHash, draftVersion: draft.draftVersion }
}

async function stepShortsSubmitRender(args: {
  jobId: string
  assetId: string
  propsHash: string
  draftVersion: number
}): Promise<{ workerSkipped: boolean }> {
  "use step"
  const { artifactExists } = await import("@/services/storage")
  const shortsArtifacts = await import("@/lib/shorts-artifacts")
  const { parseShortsRenderPropsArtifact } = await import("@/lib/shorts-props")
  // Pure-subpath import (constant only) — allowed in manager server code.
  const { COMPOSITIONS_VERSION } =
    await import("@forge/shorts-compositions/version")

  // Reuse-not-rerun: a previous render with the SAME propsHash AND the SAME
  // compositions version whose output still exists is reused (provenance-
  // checked via the worker's render meta echoing the opaque hash back) —
  // e.g. a relaunch after a Mux-output failure must not re-pay a full
  // Remotion render. The version check compares against MANAGER's baked
  // COMPOSITIONS_VERSION: after a @forge/shorts-compositions deploy
  // (template/styling fix) an unchanged draft must re-render instead of
  // returning the old output forever. The worker may carry a different baked
  // version (deploy skew) — a mismatch just re-renders, and the worker then
  // stamps its own version into fresh render meta.
  // A missing render meta falls out of the read-with-catch as null — no
  // existence pre-check needed.
  const renderMeta = shortsArtifacts.parseShortsRenderMeta(
    await readJsonArtifact(
      args.assetId,
      shortsArtifacts.SHORTS_RENDER_META_ARTIFACT_TYPE,
    ).catch(() => null),
  )
  if (
    renderMeta &&
    renderMeta.propsHash === args.propsHash &&
    renderMeta.compositionsVersion === COMPOSITIONS_VERSION
  ) {
    const outputExists = await artifactExists(
      args.assetId,
      shortsArtifacts.SHORTS_OUTPUT_ARTIFACT_TYPE,
      "mp4",
    )
    if (outputExists) {
      return { workerSkipped: true }
    }
  }

  // Re-read the audit artifact written by the resolve step: its props are
  // the exact payload to submit. The propsHash match pins provenance.
  const audit = parseShortsRenderPropsArtifact(
    await readJsonArtifact(
      args.assetId,
      shortsArtifacts.SHORTS_RENDER_PROPS_ARTIFACT_TYPE,
    ).catch(() => null),
  )
  if (
    !audit ||
    audit.propsHash !== args.propsHash ||
    audit.draftVersion !== args.draftVersion
  ) {
    throw new FatalError(
      `render_props_audit_mismatch: shorts-render-props-v1 for ${args.assetId} is missing or does not match propsHash ${args.propsHash} (draftVersion ${args.draftVersion}) — relaunch the render`,
    )
  }

  const { runShortsWorkerJob, SHORTS_RENDER_POLL_TIMEOUT_MS } =
    await import("@/services/shorts-worker")

  const result = await runShortsWorkerJob({
    body: {
      kind: "render",
      jobId: args.jobId,
      assetId: args.assetId,
      propsHash: args.propsHash,
      draftVersion: args.draftVersion,
      props: audit.props,
    },
    pollTimeoutMs: SHORTS_RENDER_POLL_TIMEOUT_MS,
    onProgress: await createStepProgressReporter(args.jobId, "shorts_render"),
  })

  if (!result.ok) {
    throwStepFailure(
      result,
      `shorts-worker render failed (${result.reason}): ${result.messages.join("; ")}`,
    )
  }

  return { workerSkipped: false }
}

type MuxOutputPollOutcome =
  | { status: "ready"; playbackId?: string }
  | { status: "errored" }

// Polls a Mux output asset until ready or errored; throws FatalError on the
// poll deadline (a retry resumes polling the SAME recorded asset, so the
// timeout never causes a duplicate creation).
async function pollMuxOutputAsset(
  getAsset: (
    assetId: string,
  ) => Promise<{ assetId: string; playbackId: string; status: string }>,
  muxAssetId: string,
): Promise<MuxOutputPollOutcome> {
  let elapsedMs = 0
  for (;;) {
    const snapshot = await getAsset(muxAssetId)
    if (snapshot.status === "ready") {
      return { status: "ready", playbackId: snapshot.playbackId || undefined }
    }
    if (snapshot.status === "errored") {
      return { status: "errored" }
    }
    if (elapsedMs + MUX_OUTPUT_POLL_INTERVAL_MS > MUX_OUTPUT_POLL_TIMEOUT_MS) {
      throw new FatalError(
        `mux_output_timeout: Mux output asset ${muxAssetId} was not ready within ${MUX_OUTPUT_POLL_TIMEOUT_MS}ms — retry resumes polling this asset`,
      )
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, MUX_OUTPUT_POLL_INTERVAL_MS),
    )
    elapsedMs += MUX_OUTPUT_POLL_INTERVAL_MS
  }
}

async function stepShortsMuxOutput(args: {
  jobId: string
  assetId: string
  propsHash: string
}): Promise<
  | { outcome: "presign_unavailable" }
  | { outcome: "exists" | "created"; muxAssetId: string; playbackId?: string }
> {
  "use step"
  const { artifactExists, writeArtifact, createPresignedArtifactUrl } =
    await import("@/services/storage")
  const shortsArtifacts = await import("@/lib/shorts-artifacts")
  const { createMuxAsset, getMuxAsset } = await import("@/services/mux")

  const writeRecord = async (
    record: import("@/lib/shorts-artifacts").ShortsMuxOutputRecord,
  ) => {
    await writeArtifact({
      assetId: args.assetId,
      artifactType: shortsArtifacts.SHORTS_MUX_OUTPUT_ARTIFACT_TYPE,
      ext: "json",
      body: JSON.stringify(record, null, 2),
      contentType: "application/json",
    })
  }

  // Idempotency: the output record is written immediately after asset
  // creation (before readiness polling), so any retry resumes the SAME asset
  // instead of minting another billable one. Reuse/resume applies ONLY when
  // the record's propsHash matches the current render — a stale hash means
  // the operator edited the draft and re-rendered, so the recorded asset
  // points at the OLD output bytes and a fresh asset must be created (the
  // edit -> re-render loop must never serve the previous render via Mux).
  const recordExists = await artifactExists(
    args.assetId,
    shortsArtifacts.SHORTS_MUX_OUTPUT_ARTIFACT_TYPE,
    "json",
  )
  if (recordExists) {
    const record = shortsArtifacts.parseShortsMuxOutputRecord(
      await readJsonArtifact(
        args.assetId,
        shortsArtifacts.SHORTS_MUX_OUTPUT_ARTIFACT_TYPE,
      ).catch(() => null),
    )
    if (record && record.propsHash === args.propsHash) {
      if (record.ready) {
        return {
          outcome: "exists",
          muxAssetId: record.muxAssetId,
          playbackId: record.playbackId,
        }
      }
      // Asset created on a previous attempt but readiness was never recorded
      // — resume polling instead of creating a duplicate.
      const resumed = await pollMuxOutputAsset(getMuxAsset, record.muxAssetId)
      if (resumed.status === "ready") {
        await writeRecord(
          shortsArtifacts.buildShortsMuxOutputRecord({
            jobId: args.jobId,
            muxAssetId: record.muxAssetId,
            propsHash: args.propsHash,
            ready: true,
            playbackId: resumed.playbackId,
            createdAt: record.createdAt,
          }),
        )
        return {
          outcome: "exists",
          muxAssetId: record.muxAssetId,
          playbackId: resumed.playbackId,
        }
      }
      // Errored assets never recover — fall through and create a fresh one,
      // overwriting the record so future retries track the new asset.
      console.warn(
        `[shorts] event=mux_output_recreate jobId=${args.jobId} assetId=${args.assetId} muxAssetId=${record.muxAssetId} reason=errored`,
      )
    } else if (record) {
      // Record from a DIFFERENT render (stale propsHash, or a legacy record
      // without one) — never reuse or resume it; create a fresh asset from
      // the new output and overwrite the record.
      console.warn(
        `[shorts] event=mux_output_recreate jobId=${args.jobId} assetId=${args.assetId} muxAssetId=${record.muxAssetId} reason=stale_props_hash`,
      )
    }
    // Malformed record — fall through and recreate.
  }

  const presignedUrl = await createPresignedArtifactUrl(
    args.assetId,
    shortsArtifacts.SHORTS_OUTPUT_ARTIFACT_TYPE,
    "mp4",
    OUTPUT_PRESIGN_TTL_SECONDS,
  )
  if (presignedUrl === null) {
    return { outcome: "presign_unavailable" }
  }

  const created = await createMuxAsset({
    inputUrl: presignedUrl,
    passthrough: args.jobId,
  })

  // Persist the asset id BEFORE polling — if anything below throws, the
  // retry resumes this asset instead of creating a duplicate.
  await writeRecord(
    shortsArtifacts.buildShortsMuxOutputRecord({
      jobId: args.jobId,
      muxAssetId: created.assetId,
      propsHash: args.propsHash,
      ready: false,
    }),
  )

  console.log(
    `[shorts] event=mux_output_created jobId=${args.jobId} assetId=${args.assetId} muxAssetId=${created.assetId}`,
  )

  const polled: MuxOutputPollOutcome =
    created.status === "ready"
      ? { status: "ready", playbackId: created.playbackId || undefined }
      : await pollMuxOutputAsset(getMuxAsset, created.assetId)

  if (polled.status === "errored") {
    throw new FatalError(
      `mux_output_errored: Mux output asset ${created.assetId} errored during preparation — retry will create a fresh asset`,
    )
  }

  await writeRecord(
    shortsArtifacts.buildShortsMuxOutputRecord({
      jobId: args.jobId,
      muxAssetId: created.assetId,
      propsHash: args.propsHash,
      ready: true,
      playbackId: polled.playbackId,
    }),
  )

  return {
    outcome: "created",
    muxAssetId: created.assetId,
    playbackId: polled.playbackId,
  }
}
