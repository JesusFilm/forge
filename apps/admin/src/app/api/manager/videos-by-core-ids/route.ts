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
  targetLocale?: unknown
  items?: unknown
}

type LookupItem = {
  coreId: string
  targetLocale: string | null
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

  const parsedItems = parseLookupItems(body)
  if (!parsedItems.ok) {
    return Response.json(
      { error: "Validation failed", details: parsedItems.details },
      { status: 400 },
    )
  }

  const items = parsedItems.items
  if (items.length > VIDEOS_BY_CORE_IDS_MAX) {
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
    const videos = await loadVideosByLocaleGroups(items)
    console.warn(
      `[videosByCoreIds] event=rest_lookup.complete coreIdCount=${items.length} rowCount=${videos.length} durationMs=${Date.now() - startedAt}`,
    )
    return Response.json({ videos }, { status: 200 })
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError"
    const maybeCode = (error as { code?: unknown } | null)?.code
    const errorCode =
      typeof maybeCode === "string" ? ` errorCode=${maybeCode}` : ""
    console.warn(
      `[videosByCoreIds] event=rest_lookup.failed coreIdCount=${items.length} durationMs=${Date.now() - startedAt} errorName=${errorName}${errorCode}`,
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

function parseLookupItems(
  body: VideosByCoreIdsBody,
): { ok: true; items: LookupItem[] } | { ok: false; details: string } {
  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) {
      return { ok: false, details: "items must be an array" }
    }
    const items: LookupItem[] = []
    for (const item of body.items) {
      if (typeof item !== "object" || item === null) {
        return { ok: false, details: "items entries must be objects" }
      }
      const row = item as Record<string, unknown>
      if (typeof row.coreId !== "string") {
        return { ok: false, details: "items[].coreId must be a string" }
      }
      const targetLocale = normalizeTargetLocale(row.targetLocale)
      if (targetLocale === false) {
        return {
          ok: false,
          details: "items[].targetLocale must be a non-empty string when set",
        }
      }
      items.push({ coreId: row.coreId, targetLocale })
    }
    return { ok: true, items }
  }

  if (
    !Array.isArray(body.coreIds) ||
    !body.coreIds.every((coreId) => typeof coreId === "string")
  ) {
    return { ok: false, details: "coreIds must be string[]" }
  }
  const targetLocale = normalizeTargetLocale(body.targetLocale)
  if (targetLocale === false) {
    return {
      ok: false,
      details: "targetLocale must be a non-empty string when set",
    }
  }
  return {
    ok: true,
    items: body.coreIds.map((coreId) => ({
      coreId,
      targetLocale,
    })),
  }
}

function normalizeTargetLocale(value: unknown): string | null | false {
  if (value == null) return null
  if (typeof value !== "string") return false
  const normalized = value.trim()
  return normalized.length > 0 ? normalized.toLowerCase() : false
}

async function loadVideosByLocaleGroups(items: readonly LookupItem[]) {
  const service = createServices(prisma).video
  const groups = new Map<
    string,
    { targetLocale: string | null; coreIds: string[] }
  >()
  for (const item of items) {
    const key = item.targetLocale ?? ""
    let group = groups.get(key)
    if (!group) {
      group = { targetLocale: item.targetLocale, coreIds: [] }
      groups.set(key, group)
    }
    group.coreIds.push(item.coreId)
  }

  const videos: Awaited<ReturnType<typeof service.getByCoreIds>> = []
  for (const group of groups.values()) {
    videos.push(
      ...(await service.getByCoreIds({
        coreIds: group.coreIds,
        targetLocale: group.targetLocale,
      })),
    )
  }
  return videos
}
