import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { env } from "../config/env.js"
import { sendJson } from "../http.js"
import {
  MatchJobService,
  SafeMatchJobError,
} from "../services/match-job.service.js"

export type MatchJobsRouteOptions = {
  maxUploadBytes?: number
  autoProcess?: boolean
  apiToken?: string
}

export function createMatchJobsRoute(
  service: MatchJobService,
  {
    maxUploadBytes = env.MAX_UPLOAD_BYTES,
    autoProcess = true,
    apiToken = env.MAPPER_API_TOKEN,
  }: MatchJobsRouteOptions = {},
) {
  return async function handleMatchJobsRoute(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    if (request.method === "POST" && url.pathname === "/match-jobs") {
      if (!isAuthorized(request, apiToken)) {
        sendJson(response, 401, { error: "unauthorized" })
        return true
      }

      await createJob(request, response, service, {
        maxUploadBytes,
        autoProcess,
      })
      return true
    }

    const jobId = matchJobId(url.pathname)
    const processJobId = matchJobProcessId(url.pathname)

    if (request.method === "POST" && processJobId) {
      if (!isAuthorized(request, apiToken)) {
        sendJson(response, 401, { error: "unauthorized" })
        return true
      }

      const before = await service.getJobResult(processJobId)
      if (!before) {
        sendJson(response, 404, { error: "job_not_found" })
        return true
      }

      await service.processJob(processJobId)
      const result = await service.getJobResult(processJobId)
      sendJson(response, 200, result ?? { error: "job_not_found" })
      return true
    }

    if (request.method === "GET" && jobId) {
      if (!isAuthorized(request, apiToken)) {
        sendJson(response, 401, { error: "unauthorized" })
        return true
      }

      const result = await service.getJobResult(jobId)

      if (!result) {
        sendJson(response, 404, { error: "job_not_found" })
        return true
      }

      sendJson(response, 200, result)
      return true
    }

    return false
  }
}

function isAuthorized(
  request: IncomingMessage,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken && env.NODE_ENV !== "production") return true
  if (!expectedToken) return false

  const header = request.headers.authorization
  const authorization = Array.isArray(header) ? header[0] : header

  return timingSafeStringEqual(authorization, `Bearer ${expectedToken}`)
}

function timingSafeStringEqual(
  actual: string | undefined,
  expected: string,
): boolean {
  if (!actual) return false

  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)

  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}

async function createJob(
  request: IncomingMessage,
  response: ServerResponse,
  service: MatchJobService,
  {
    maxUploadBytes,
    autoProcess,
  }: {
    maxUploadBytes: number
    autoProcess: boolean
  },
): Promise<void> {
  try {
    const bytes = await readRequestBody(request, maxUploadBytes)
    const job = await service.createUploadJob({
      bytes,
      contentType: contentTypeFrom(request),
    })

    if (autoProcess) {
      void service.processJob(job.id).catch((error: unknown) => {
        console.error("match job auto-processing failed", error)
      })
    }

    sendJson(response, 202, {
      jobId: job.id,
      status: job.status,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      sendJson(response, 413, { error: "upload_too_large" })
      return
    }

    if (error instanceof SafeMatchJobError) {
      sendJson(response, 400, { error: error.code })
      return
    }

    sendJson(response, 500, { error: "internal_error" })
  }
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength

    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError()
    }

    chunks.push(bytes)
  }

  return Buffer.concat(chunks)
}

function contentTypeFrom(request: IncomingMessage): string {
  const header = request.headers["content-type"]
  return Array.isArray(header)
    ? (header[0] ?? "application/octet-stream")
    : (header ?? "application/octet-stream")
}

function matchJobId(pathname: string): string | null {
  const match = /^\/match-jobs\/([^/]+)$/.exec(pathname)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function matchJobProcessId(pathname: string): string | null {
  const match = /^\/match-jobs\/([^/]+)\/process$/.exec(pathname)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

class RequestBodyTooLargeError extends Error {}
