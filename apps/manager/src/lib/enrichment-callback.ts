import { z } from "zod"
import {
  CallbackStepDetailsSchema,
  CallbackReportsSchema,
  CALLBACK_MAX_ARTIFACTS,
  CALLBACK_MAX_LANGUAGES,
} from "@/lib/enrichment-callback-contract"

import { applyJobCallbackUpdate } from "@/lib/state"
import { FORGE_WORKFLOW_STEPS } from "@/lib/workflow-steps"
import type { JobStepDetails, StepStatus } from "@/types/job"

const CALLBACK_ID_MAX_LENGTH = 128
const CALLBACK_ERROR_MAX_LENGTH = 2_000
const CALLBACK_ARTIFACT_KEY_MAX_LENGTH = 128
const CALLBACK_LANGUAGE_RESULTS_MAX = CALLBACK_MAX_LANGUAGES

const translationLanguageResultSchema = z
  .object({
    lang: z.string().min(1).max(32),
    status: z.enum(["completed", "failed"]),
    error: z.string().max(CALLBACK_ERROR_MAX_LENGTH).optional(),
  })
  .strict()

const callbackBaseSchema = z
  .object({
    jobId: z.string().min(1).max(CALLBACK_ID_MAX_LENGTH),
    engine: z.literal("mastra"),
    runId: z.string().min(1).max(CALLBACK_ID_MAX_LENGTH),
    sequence: z.number().int().nonnegative(),
    step: z.enum(FORGE_WORKFLOW_STEPS),
    jobStatus: z.enum(["completed", "failed"]).optional(),
  })
  .strict()

const callbackArtifactsSchema = z
  .object({
    artifactsDelta: z
      .array(z.string().min(1).max(CALLBACK_ARTIFACT_KEY_MAX_LENGTH))
      .max(CALLBACK_MAX_ARTIFACTS)
      .optional(),
    details: CallbackStepDetailsSchema.optional(),
    reports: CallbackReportsSchema.optional(),
    languageResults: z
      .array(translationLanguageResultSchema)
      .max(CALLBACK_LANGUAGE_RESULTS_MAX)
      .refine(
        (results) =>
          new Set(results.map((result) => result.lang.toLowerCase())).size ===
          results.length,
        "Duplicate languages",
      )
      .optional(),
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
    error: z.string().min(1).max(CALLBACK_ERROR_MAX_LENGTH),
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
  | { ok: false; status: 400 | 503; error: string }

function toStepStatus(status: EnrichmentCallback["status"]): StepStatus {
  return status
}

function getStepDetails(
  callback: EnrichmentCallback,
): JobStepDetails | undefined {
  if (callback.status !== "completed" && callback.status !== "failed") {
    return undefined
  }

  if (!callback.languageResults?.length && !callback.details) return undefined
  return {
    ...callback.details,
    ...(callback.languageResults
      ? { languageResults: callback.languageResults }
      : {}),
  }
}

export async function applyEnrichmentCallback(
  callback: EnrichmentCallback,
): Promise<ApplyEnrichmentCallbackResult> {
  const result = await applyJobCallbackUpdate({
    jobId: callback.jobId,
    runId: callback.runId,
    sequence: callback.sequence,
    step: callback.step,
    status: toStepStatus(callback.status),
    jobStatus: callback.jobStatus,
    error: callback.status === "failed" ? callback.error : undefined,
    details: getStepDetails(callback),
    reports:
      callback.status === "completed" || callback.status === "failed"
        ? callback.reports
        : undefined,
    artifactsDelta:
      callback.status === "completed" || callback.status === "failed"
        ? callback.artifactsDelta
        : undefined,
  })

  if (result.status === "applied") {
    return { ok: true, action: "applied" }
  }
  if (result.status === "not-found") {
    return { ok: true, action: "dropped", reason: "unknown_job" }
  }
  if (result.status === "dropped") {
    return { ok: true, action: "dropped", reason: result.reason }
  }
  if (result.status === "invalid") {
    return { ok: false, status: 400, error: result.error }
  }

  return {
    ok: false,
    status: 503,
    error: "Callback job update failed; retry later",
  }
}
