import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"
import { prisma } from "@/db/client"
import {
  PrecomputedRecommendationError,
  submitPrecomputedRecommendation,
} from "@/services/recommendations/precomputed/contract"
import { submitDurablePrecomputedRecommendation } from "@/services/recommendations/precomputed/durable-build"

const MAX_BODY_BYTES = 2 * 1024 * 1024

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

async function readJson(request: Request): Promise<unknown | Response> {
  if (
    !/^\s*application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return error("Content-Type must be application/json", 415)
  }
  const declared = request.headers.get("content-length")
  if (
    declared != null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
  ) {
    return error("Invalid or oversized Content-Length", 413)
  }
  if (!request.body) return error("Invalid JSON body", 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return error("JSON body is too large", 413)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { action?: unknown }).action === "string" &&
      (parsed as { action: string }).action.startsWith("profile_") &&
      size > 65_536
    )
      return error("Profile action body exceeds 64 KiB", 413)
    return parsed
  } catch {
    return error("Invalid JSON body", 400)
  }
}

export async function POST(request: Request): Promise<Response> {
  if (
    !isValidMastraRecommendationIngestBearer(
      request.headers.get("authorization"),
    )
  ) {
    return error("Authorization required", 401)
  }
  const body = await readJson(request)
  if (body instanceof Response) return body
  try {
    const payload =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : null
    const isDurable =
      payload?.protocolVersion === 2 ||
      payload?.protocolVersion === 3 ||
      payload?.protocolVersion === 4 ||
      payload?.action === "retention_status" ||
      typeof payload?.generationInputDigest === "string"
    return Response.json({
      result: isDurable
        ? await submitDurablePrecomputedRecommendation(
            prisma,
            body,
            request.headers.get("authorization"),
          )
        : await submitPrecomputedRecommendation(
            prisma,
            body,
            request.headers.get("authorization"),
          ),
    })
  } catch (cause) {
    if (cause instanceof PrecomputedRecommendationError) {
      return Response.json(
        { error: cause.message, reason: cause.code },
        {
          status:
            cause.code === "unauthorized"
              ? 401
              : cause.code === "invalid"
                ? 400
                : cause.code === "not_found"
                  ? 404
                  : 409,
        },
      )
    }
    console.warn("[precomputed-recommendation-ingest] write_failed")
    return error("Recommendation build write failed", 502)
  }
}

export async function GET(): Promise<Response> {
  return error("Authorization required", 401)
}
