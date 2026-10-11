import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"
import { prisma } from "@/db/client"
import { configuredGaCaptureStore } from "@/services/recommendations/precomputed/ga-capture-store"
import {
  handleGaCaptureGet,
  handleGaCapturePost,
} from "@/services/recommendations/precomputed/ga-capture-transport"

export async function POST(request: Request): Promise<Response> {
  if (
    !isValidMastraRecommendationIngestBearer(
      request.headers.get("authorization"),
    )
  )
    return Response.json({ error: "Authorization required" }, { status: 401 })
  try {
    return await handleGaCapturePost(
      prisma,
      request,
      configuredGaCaptureStore(),
    )
  } catch {
    return Response.json(
      { error: "Private GA capture storage unavailable" },
      { status: 502 },
    )
  }
}

export async function GET(request: Request): Promise<Response> {
  if (
    !isValidMastraRecommendationIngestBearer(
      request.headers.get("authorization"),
    )
  )
    return Response.json({ error: "Authorization required" }, { status: 401 })
  try {
    return await handleGaCaptureGet(prisma, request, configuredGaCaptureStore())
  } catch {
    return Response.json(
      { error: "Private GA capture storage unavailable" },
      { status: 502 },
    )
  }
}
