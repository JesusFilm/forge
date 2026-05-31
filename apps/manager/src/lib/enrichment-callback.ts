import { z } from "zod"

import { readEngineStamp } from "@/lib/engine-stamp"
import { buildDownloadableArtifactManifest } from "@/lib/job-artifacts"
import { resolveJobArtifactDescriptor } from "@/lib/job-artifacts"
import {
  getJobLookup,
  mergeJobArtifacts,
  updateJob,
  updateStepStatus,
} from "@/lib/state"
import type { JobStepDetails, StepStatus, WorkflowStepName } from "@/types/job"

const callbackSteps = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "audio_cleanup",
  "theology_validation_bible_quotes",
  "seo_improvements",
] as const satisfies readonly WorkflowStepName[]

const translationLanguageResultSchema = z
  .object({
    lang: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    error: z.string().optional(),
  })
  .strict()

const callbackBaseSchema = z
  .object({
    jobId: z.string().min(1),
    engine: z.literal("mastra"),
    runId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    step: z.enum(callbackSteps),
    jobStatus: z.enum(["completed", "failed"]).optional(),
  })
  .strict()

const callbackArtifactsSchema = z
  .object({
    artifactsDelta: z.array(z.string().min(1)).max(100).optional(),
    languageResults: z.array(translationLanguageResultSchema).optional(),
  })
  .strict()

export const EnrichmentCallbackSchema = z.discriminatedUnion("status", [
  callbackBaseSchema.extend({
    status: z.literal("running"),
  }),
  callbackBaseSchema.extend({
    status: z.literal("completed"),
    ...callbackArtifactsSchema.shape,
  }),
  callbackBaseSchema.extend({
    status: z.literal("failed"),
    error: z.string().min(1),
    ...callbackArtifactsSchema.shape,
  }),
  callbackBaseSchema.extend({
    status: z.literal("skipped"),
  }),
])

export type EnrichmentCallback = z.infer<typeof EnrichmentCallbackSchema>

export type ApplyEnrichmentCallbackResult =
  | { ok: true; action: "applied" }
  | { ok: true; action: "dropped"; reason: string }
  | { ok: false; status: 400; error: string }

const STATUS_RANK: Record<StepStatus, number> = {
  pending: 0,
  running: 1,
  skipped: 2,
  failed: 3,
  completed: 4,
}

function toStepStatus(status: EnrichmentCallback["status"]): StepStatus {
  return status
}

function isStaleStatus(current: StepStatus | undefined, next: StepStatus) {
  if (!current) return false
  return STATUS_RANK[next] < STATUS_RANK[current]
}

function isStaleSequence(current: number | undefined, next: number): boolean {
  return current != null && next <= current
}

function getStepDetails(
  callback: EnrichmentCallback,
): JobStepDetails | undefined {
  if (callback.status !== "completed" && callback.status !== "failed") {
    return undefined
  }

  if (!callback.languageResults?.length) {
    return undefined
  }

  return { languageResults: callback.languageResults }
}

function validateArtifactKeys(keys: readonly string[] | undefined) {
  if (!keys?.length) return { ok: true as const, keys: [] as string[] }

  const invalid = keys.filter((key) => !resolveJobArtifactDescriptor(key))
  if (invalid.length > 0) {
    return {
      ok: false as const,
      error: `Unsupported artifact keys: ${invalid.join(", ")}`,
    }
  }

  return { ok: true as const, keys: [...new Set(keys)] }
}

export async function applyEnrichmentCallback(
  callback: EnrichmentCallback,
): Promise<ApplyEnrichmentCallbackResult> {
  const lookup = await getJobLookup(callback.jobId)
  if (lookup.status === "not-found") {
    return { ok: true, action: "dropped", reason: "unknown_job" }
  }
  if (lookup.status === "error") {
    return { ok: true, action: "dropped", reason: "job_lookup_failed" }
  }

  const { job } = lookup
  if (readEngineStamp(job.options) !== "mastra") {
    return { ok: true, action: "dropped", reason: "engine_mismatch" }
  }
  if (job.options.currentRunId !== callback.runId) {
    return { ok: true, action: "dropped", reason: "stale_run" }
  }

  const nextStepStatus = toStepStatus(callback.status)
  const currentStep = job.steps.find((step) => step.name === callback.step)
  if (isStaleStatus(currentStep?.status, nextStepStatus)) {
    return { ok: true, action: "dropped", reason: "stale_status" }
  }
  if (
    isStaleSequence(
      job.options.callbackSequences?.[callback.step],
      callback.sequence,
    )
  ) {
    return { ok: true, action: "dropped", reason: "stale_sequence" }
  }

  if (callback.status === "completed" || callback.status === "failed") {
    const artifacts = validateArtifactKeys(callback.artifactsDelta)
    if (!artifacts.ok) {
      return { ok: false, status: 400, error: artifacts.error }
    }
    if (artifacts.keys.length > 0) {
      await mergeJobArtifacts(
        callback.jobId,
        buildDownloadableArtifactManifest(artifacts.keys),
      )
    }
  }

  await updateStepStatus(
    callback.jobId,
    callback.step,
    nextStepStatus,
    callback.status === "failed" ? callback.error : undefined,
    getStepDetails(callback),
  )

  const callbackSequences = {
    ...(job.options.callbackSequences ?? {}),
    [callback.step]: callback.sequence,
  }
  const jobUpdate = {
    options: {
      ...job.options,
      callbackSequences,
    },
  }

  if (callback.status === "running") {
    await updateJob(callback.jobId, {
      ...jobUpdate,
      status: "running",
      currentStep: callback.step,
    })
  } else if (callback.jobStatus) {
    await updateJob(callback.jobId, {
      ...jobUpdate,
      status: callback.jobStatus,
      currentStep: undefined,
      completedAt:
        callback.jobStatus === "completed"
          ? new Date().toISOString()
          : undefined,
    })
  } else {
    await updateJob(callback.jobId, jobUpdate)
  }

  return { ok: true, action: "applied" }
}
