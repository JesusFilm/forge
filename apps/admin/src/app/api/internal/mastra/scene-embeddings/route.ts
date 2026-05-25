import { isValidMastraSceneIngestBearer } from "@/auth/mastra-ingest-bearer"
import { prisma } from "@/db/client"
import {
  ingestSceneEmbeddings,
  SceneEmbeddingIngestError,
} from "@/services/scene-embedding-ingest.service"

function unauthorized(): Response {
  return Response.json({ error: "Authorization required" }, { status: 401 })
}

function statusForError(error: SceneEmbeddingIngestError): number {
  switch (error.code) {
    case "payload_invalid":
    case "dimension_mismatch":
    case "scene_invalid":
    case "source_hash_mismatch":
      return 400
    case "target_not_found":
      return 404
    case "write_failed":
      return 502
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isValidMastraSceneIngestBearer(request.headers.get("authorization"))) {
    return unauthorized()
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const result = await ingestSceneEmbeddings(prisma, body)
    const status = result.status === "rejected" ? 409 : 200
    return Response.json({ result }, { status })
  } catch (error) {
    if (error instanceof SceneEmbeddingIngestError) {
      console.warn(
        `[mastra-scene-ingest] event=ingest_failed code=${error.code}`,
      )
      return Response.json(
        {
          error: "Scene embedding ingest failed",
          reason: error.code,
          retryable: error.code === "write_failed",
        },
        { status: statusForError(error) },
      )
    }

    console.warn(`[mastra-scene-ingest] event=ingest_failed code=unknown`)
    return Response.json(
      {
        error: "Scene embedding ingest failed",
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
