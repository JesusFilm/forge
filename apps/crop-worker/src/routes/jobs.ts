// POST /jobs + GET /jobs/{workerJobId} — the crop-worker HTTP contract from
// docs/plans/2026-06-09-002-feat-smart-crop-plan.md ("Crop-worker HTTP API").

import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import { validateBearer, type ValidateBearerOptions } from "../auth.js"
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

const sourceSchema = z.looseObject({
  url: z.string().min(1),
})

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
    cropPlan: z.looseObject({ assetId: z.string().min(1) }),
    timelineMap: z.looseObject({ assetId: z.string().min(1) }).optional(),
    previewFrameCount: z.number().int().min(0).max(32).optional().default(0),
  }),
})

export const jobRequestSchema = z.discriminatedUnion("kind", [
  fingerprintJobSchema,
  renderJobSchema,
])

export type JobRequest = z.infer<typeof jobRequestSchema>

export type JobsRouteOptions = {
  queue: JobQueue
  auth?: ValidateBearerOptions
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
  runFingerprintImpl = runFingerprint,
  runRenderImpl = runRender,
}: JobsRouteOptions) {
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

    const parsed = jobRequestSchema.safeParse(rawBody)
    if (!parsed.success) {
      sendJson(response, 400, { error: "invalid_body" })
      return
    }
    const body = parsed.data

    const outcome =
      body.kind === "fingerprint"
        ? queue.submit("fingerprint", async () => {
            const summary = await runFingerprintImpl({
              assetId: body.assetId,
              sourceUrl: body.source.url,
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
        : queue.submit("render", async ({ onProgress }) =>
            runRenderImpl({
              assetId: body.assetId,
              sourceUrl: body.source.url,
              mode: body.render.mode,
              cropPlanAssetId: body.render.cropPlan.assetId,
              timelineMapAssetId: body.render.timelineMap?.assetId,
              previewFrameCount: body.render.previewFrameCount,
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

    console.log(
      `[crop-worker] event=job_submitted workerJobId=${outcome.job.workerJobId} kind=${body.kind} jobId=${body.jobId} assetId=${body.assetId}`,
    )
    sendJson(response, 202, {
      workerJobId: outcome.job.workerJobId,
      status: "queued",
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
