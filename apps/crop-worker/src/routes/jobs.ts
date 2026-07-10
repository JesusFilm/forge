// POST /jobs + GET /jobs/{workerJobId} — the crop-worker HTTP contract from
// docs/plans/2026-06-09-002-feat-smart-crop-plan.md ("Crop-worker HTTP API").

import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import { validateBearer, type ValidateBearerOptions } from "../auth.js"
import { env } from "../config/env.js"
import {
  CROP_PLAN_ARTIFACT_TYPE,
  cropPlanArtifactTypeSchema,
  renderArtifactSuffixSchema,
} from "../crop-plan.js"
import { createJobDeadline } from "../deadline.js"
import { FINGERPRINT_ARTIFACT_TYPE, runFingerprint } from "../fingerprint.js"
import {
  InvalidJsonBodyError,
  readJsonBody,
  RequestBodyTooLargeError,
  sendJson,
  UnsupportedContentTypeError,
} from "../http.js"
import type { JobQueue, JobRecord } from "../jobs.js"
import { runRender } from "../render.js"
import type { JobStatusBody } from "../types.js"

// In production source.url must be a parseable https URL (the wire contract
// is https://stream.mux.com/{playbackId}.m3u8); the -protocol_whitelist on
// the ffmpeg/ffprobe invocations is the second, independent layer. Outside
// production any non-empty string is accepted so local-path smokes work.
function createSourceSchema(nodeEnv: string) {
  return z.looseObject({
    url: z
      .string()
      .min(1)
      .refine((value) => {
        if (nodeEnv !== "production") return true
        try {
          return new URL(value).protocol === "https:"
        } catch {
          return false
        }
      }, "source.url must be an https URL in production"),
  })
}

export function createJobRequestSchema(nodeEnv: string = env.NODE_ENV) {
  const sourceSchema = createSourceSchema(nodeEnv)

  const fingerprintJobSchema = z.looseObject({
    kind: z.literal("fingerprint"),
    jobId: z.string().min(1),
    assetId: z.string().min(1),
    source: sourceSchema,
  })

  const renderJobSchema = z.looseObject({
    kind: z.literal("render"),
    jobId: z.string().min(1),
    assetId: z.string().min(1),
    source: sourceSchema,
    render: z.looseObject({
      mode: z.enum(["preview", "full"]),
      cropPlan: z.looseObject({
        assetId: z.string().min(1),
        artifactType: cropPlanArtifactTypeSchema
          .optional()
          .default(CROP_PLAN_ARTIFACT_TYPE),
      }),
      timelineMap: z.looseObject({ assetId: z.string().min(1) }).optional(),
      artifactSuffix: renderArtifactSuffixSchema.optional(),
      previewFrameCount: z.number().int().min(0).max(32).optional().default(0),
    }),
  })

  return z.discriminatedUnion("kind", [fingerprintJobSchema, renderJobSchema])
}

export const jobRequestSchema = createJobRequestSchema()

export type JobRequest = z.infer<typeof jobRequestSchema>

// Logical job identity for in-flight dedupe. Mirrors what makes two
// submissions byte-identical work: the target asset plus (for renders) the
// mode, plan/map inputs, and attempt output suffix. Deliberately excludes the
// manager jobId so a re-launched workflow or operator retry re-attaches to the
// running job.
export function jobDedupeKey(body: JobRequest): string {
  if (body.kind === "fingerprint") {
    return `fingerprint:${body.assetId}`
  }
  return `render:${body.assetId}:${body.render.mode}:${body.render.cropPlan.assetId}:${body.render.cropPlan.artifactType}:${body.render.timelineMap?.assetId ?? ""}:${body.render.artifactSuffix ?? ""}`
}

export type JobsRouteOptions = {
  queue: JobQueue
  auth?: ValidateBearerOptions
  /** Drives the production-only https check on source.url (defaults to env). */
  nodeEnv?: string
  runFingerprintImpl?: typeof runFingerprint
  runRenderImpl?: typeof runRender
}

function toStatusBody(job: JobRecord): JobStatusBody {
  return {
    workerJobId: job.workerJobId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result,
  }
}

export function createJobsRoute({
  queue,
  auth = {},
  nodeEnv = env.NODE_ENV,
  runFingerprintImpl = runFingerprint,
  runRenderImpl = runRender,
}: JobsRouteOptions) {
  const requestSchema = createJobRequestSchema(nodeEnv)

  function authorize(
    request: IncomingMessage,
    response: ServerResponse,
  ): boolean {
    const outcome = validateBearer(request.headers.authorization, auth)
    if (outcome === "ok") return true

    if (outcome === "config_missing") {
      sendJson(response, 503, { error: "config_missing" })
      return false
    }

    sendJson(response, 401, { error: "unauthorized" })
    return false
  }

  async function submitJob(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    let rawBody: unknown
    try {
      rawBody = await readJsonBody(request)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(response, 413, { error: "body_too_large" })
        return
      }
      if (
        error instanceof UnsupportedContentTypeError ||
        error instanceof InvalidJsonBodyError
      ) {
        sendJson(response, 400, { error: "invalid_body" })
        return
      }
      throw error
    }

    const parsed = requestSchema.safeParse(rawBody)
    if (!parsed.success) {
      sendJson(response, 400, { error: "invalid_body" })
      return
    }
    const body = parsed.data

    const dedupeKey = jobDedupeKey(body)

    // The per-job deadline starts here at ENQUEUE time, not job start —
    // manager's poll budget includes queue wait, so the worker's deadline
    // must too. Budgets stay strictly below manager's poll ceilings (see
    // config/env.ts). On a dedupe hit the fresh deadline is discarded; the
    // running job keeps the deadline from its own enqueue.
    const deadline = createJobDeadline(
      body.kind === "fingerprint"
        ? env.CROP_WORKER_FINGERPRINT_JOB_TIMEOUT_MS
        : body.render.mode === "preview"
          ? env.CROP_WORKER_RENDER_PREVIEW_JOB_TIMEOUT_MS
          : env.CROP_WORKER_RENDER_FULL_JOB_TIMEOUT_MS,
    )

    const outcome =
      body.kind === "fingerprint"
        ? queue.submit("fingerprint", dedupeKey, async () => {
            const summary = await runFingerprintImpl({
              assetId: body.assetId,
              sourceUrl: body.source.url,
              deps: { deadline },
            })
            return {
              artifacts: [
                {
                  assetId: body.assetId,
                  artifactType: FINGERPRINT_ARTIFACT_TYPE,
                  ext: "json",
                },
              ],
              report: summary,
            }
          })
        : queue.submit("render", dedupeKey, async ({ onProgress }) =>
            runRenderImpl({
              assetId: body.assetId,
              sourceUrl: body.source.url,
              mode: body.render.mode,
              cropPlanAssetId: body.render.cropPlan.assetId,
              cropPlanArtifactType: body.render.cropPlan.artifactType,
              timelineMapAssetId: body.render.timelineMap?.assetId,
              artifactSuffix: body.render.artifactSuffix,
              previewFrameCount: body.render.previewFrameCount,
              deps: { deadline },
              onProgress,
            }),
          )

    if (!outcome.ok) {
      console.warn(
        `[crop-worker] event=job_rejected reason=queue_full kind=${body.kind} jobId=${body.jobId}`,
      )
      sendJson(response, 409, { error: "queue_full" })
      return
    }

    if (outcome.deduped) {
      console.log(
        `[crop-worker] event=job_deduped workerJobId=${outcome.job.workerJobId} kind=${body.kind} jobId=${body.jobId} assetId=${body.assetId} status=${outcome.job.status}`,
      )
    } else {
      console.log(
        `[crop-worker] event=job_submitted workerJobId=${outcome.job.workerJobId} kind=${body.kind} jobId=${body.jobId} assetId=${body.assetId}`,
      )
    }
    // On a dedupe hit this re-attaches the caller to the ACTIVE job: same
    // workerJobId, current status ("queued" | "running"). Manager's submit
    // client accepts any known status on the 202 path.
    sendJson(response, 202, {
      workerJobId: outcome.job.workerJobId,
      status: outcome.job.status,
    })
  }

  return async function handleJobsRoute(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method === "POST" && url.pathname === "/jobs") {
      if (!authorize(request, response)) return true
      await submitJob(request, response)
      return true
    }

    const match = /^\/jobs\/([^/]+)$/.exec(url.pathname)
    if (request.method === "GET" && match?.[1]) {
      if (!authorize(request, response)) return true

      const job = queue.get(decodeURIComponent(match[1]))
      if (!job) {
        sendJson(response, 404, { error: "not_found" })
        return true
      }

      sendJson(response, 200, toStatusBody(job))
      return true
    }

    return false
  }
}
