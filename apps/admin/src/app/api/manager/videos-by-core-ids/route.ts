// Server-to-server dispatch-field lookup for apps/manager.
//
// This route mirrors the data returned by GraphQL `videosByCoreIds`
// while bypassing GraphQL/Yoga middleware for the hot manager
// enrichment-trigger path. Auth reuses admin's WORKFLOW_API_KEYS
// bearer allowlist via `isValidWorkflowBearer`; no browser caller
// should hit this route directly.

import { isValidWorkflowBearer } from "@/auth/workflow-bearer"
import { prisma } from "@/db/client"
import { createServices } from "@/services"
import {
  VideoLookupValidationError,
  VIDEOS_BY_CORE_IDS_MAX,
} from "@/services/video.service"

type VideosByCoreIdsBody = {
  coreIds?: unknown
}

function unauthorized(): Response {
  return Response.json({ error: "Authorization required" }, { status: 401 })
}

export async function POST(request: Request): Promise<Response> {
  if (!isValidWorkflowBearer(request.headers.get("authorization"))) {
    return unauthorized()
  }

  let body: VideosByCoreIdsBody
  try {
    body = (await request.json()) as VideosByCoreIdsBody
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (
    !Array.isArray(body.coreIds) ||
    !body.coreIds.every((coreId) => typeof coreId === "string")
  ) {
    return Response.json(
      { error: "Validation failed", details: "coreIds must be string[]" },
      { status: 400 },
    )
  }

  if (body.coreIds.length > VIDEOS_BY_CORE_IDS_MAX) {
    return Response.json(
      {
        error: "Validation failed",
        details: `coreIds.length exceeds max ${VIDEOS_BY_CORE_IDS_MAX}`,
      },
      { status: 400 },
    )
  }

  const startedAt = Date.now()
  try {
    const videos = await createServices(prisma).video.getByCoreIds({
      coreIds: body.coreIds,
    })
    console.warn(
      `[videosByCoreIds] event=rest_lookup.complete coreIdCount=${body.coreIds.length} rowCount=${videos.length} durationMs=${Date.now() - startedAt}`,
    )
    return Response.json({ videos }, { status: 200 })
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError"
    const maybeCode = (error as { code?: unknown } | null)?.code
    const errorCode =
      typeof maybeCode === "string" ? ` errorCode=${maybeCode}` : ""
    console.warn(
      `[videosByCoreIds] event=rest_lookup.failed coreIdCount=${body.coreIds.length} durationMs=${Date.now() - startedAt} errorName=${errorName}${errorCode}`,
    )

    if (error instanceof VideoLookupValidationError) {
      return Response.json(
        { error: "Validation failed", details: error.message },
        { status: 400 },
      )
    }

    return Response.json(
      {
        error: "Lookup failed",
        reason: "lookup_failed",
        retryable: true,
      },
      { status: 502 },
    )
  }
}

export async function GET(): Promise<Response> {
  return unauthorized()
}
