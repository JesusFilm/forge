import { NextResponse } from "next/server"
import { z } from "zod"

import { isValidWatchProgressBearer } from "@/auth/watch-progress-bearer"
import { prisma } from "@/db/client"
import { deleteWatchEventsForUser } from "@/services/watch-events.service"
import {
  deleteWatchProgressForUser,
  listWatchProgress,
  upsertWatchProgress,
} from "@/services/watch-progress.service"

const MAX_ENTRIES = 200

const entrySchema = z.object({
  videoId: z.string().min(1),
  languageSlug: z.string().min(1).nullable().optional(),
  positionSeconds: z.number().finite().min(0),
  durationSeconds: z.number().finite().positive(),
  updatedAt: z.string().datetime().optional(),
})

const upsertSchema = z.object({
  userId: z.string().min(1),
  entries: z.array(entrySchema).min(1).max(MAX_ENTRIES),
})

const deleteSchema = z.object({
  userId: z.string().min(1),
})

function unauthorized() {
  return NextResponse.json({ error: "Authorization required" }, { status: 401 })
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

function requireWatchProgressBearer(request: Request): true | NextResponse {
  return isValidWatchProgressBearer(request.headers.get("authorization"))
    ? true
    : unauthorized()
}

async function readJson(request: Request): Promise<unknown | NextResponse> {
  try {
    return await request.json()
  } catch {
    return badRequest("Invalid JSON body")
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = requireWatchProgressBearer(request)
  if (auth !== true) return auth

  const url = new URL(request.url)
  const userId = url.searchParams.get("userId")
  if (!userId) return badRequest("userId is required")
  const limit = Number(url.searchParams.get("limit") ?? "200")

  const entries = await listWatchProgress({
    userId,
    limit: Number.isFinite(limit) ? limit : undefined,
  })
  return NextResponse.json({ entries })
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = requireWatchProgressBearer(request)
  if (auth !== true) return auth

  const body = await readJson(request)
  if (body instanceof NextResponse) return body

  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) return badRequest("Invalid watch progress payload")

  const entries = await upsertWatchProgress(parsed.data)
  return NextResponse.json({ entries })
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = requireWatchProgressBearer(request)
  if (auth !== true) return auth

  const body = await readJson(request)
  if (body instanceof NextResponse) return body

  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) return badRequest("userId is required")

  // Account-deletion erasure covers both watch stores in one call:
  // the progress record and the watch-event analytics log (R5).
  const result = await deleteWatchProgressForUser(parsed.data.userId)
  const events = await deleteWatchEventsForUser(prisma, parsed.data.userId)
  return NextResponse.json({
    ...result,
    deletedWatchEventCount: events.deletedCount,
  })
}
