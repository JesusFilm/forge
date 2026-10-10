import { isValidMastraTranscriptIngestBearer } from "@/auth/mastra-ingest-bearer"
import { prisma } from "@/db/client"
import {
  ingestTranscriptEmbeddings,
  TranscriptEmbeddingIngestError,
} from "@/services/transcript-embedding-ingest.service"

export const MAX_TRANSCRIPT_INGEST_BODY_BYTES = 16 * 1024 * 1024

function unauthorized(): Response {
  return Response.json({ error: "Authorization required" }, { status: 401 })
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status })
}

async function readBoundedJson(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^\s*application\/json(?:\s*;|$)/i.test(contentType)) {
    return jsonError("Content-Type must be application/json", 415)
  }

  const contentLength = request.headers.get("content-length")
  if (contentLength != null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
      return jsonError("Invalid Content-Length", 400)
    }
    if (declaredBytes > MAX_TRANSCRIPT_INGEST_BODY_BYTES) {
      return jsonError("JSON body is too large", 413)
    }
  }

  if (request.body == null) return jsonError("Invalid JSON body", 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_TRANSCRIPT_INGEST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return jsonError("JSON body is too large", 413)
      }
      chunks.push(value)
    }
  } catch {
    return jsonError("Invalid JSON body", 400)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return jsonError("Invalid JSON body", 400)
  }
}

function statusForError(error: TranscriptEmbeddingIngestError): number {
  switch (error.code) {
    case "payload_invalid":
    case "dimension_mismatch":
    case "chunk_invalid":
    case "source_hash_mismatch":
      return 400
    case "target_not_found":
      return 404
    case "target_ambiguous":
    case "contract_mismatch":
      return 409
    case "write_failed":
      return 502
  }
}

export async function POST(request: Request): Promise<Response> {
  if (
    !isValidMastraTranscriptIngestBearer(request.headers.get("authorization"))
  ) {
    return unauthorized()
  }

  const body = await readBoundedJson(request)
  if (body instanceof Response) return body

  try {
    const result = await ingestTranscriptEmbeddings(prisma, body)
    const status = result.status === "rejected" ? 409 : 200
    return Response.json({ result }, { status })
  } catch (error) {
    if (error instanceof TranscriptEmbeddingIngestError) {
      console.warn(
        `[mastra-transcript-ingest] event=ingest_failed code=${error.code}`,
      )
      return Response.json(
        {
          error: "Transcript embedding ingest failed",
          reason: error.code,
          retryable: error.code === "write_failed",
        },
        { status: statusForError(error) },
      )
    }

    console.warn(`[mastra-transcript-ingest] event=ingest_failed code=unknown`)
    return Response.json(
      {
        error: "Transcript embedding ingest failed",
        reason: "unknown",
        retryable: true,
      },
      { status: 502 },
    )
  }
}

export async function GET(): Promise<Response> {
  return unauthorized()
}
