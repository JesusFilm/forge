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
  // Required: the service drops an entry it cannot timestamp, so accepting
  // an absent value here would silently discard the write.
  updatedAt: z.string().datetime(),
})

const upsertSchema = z.object({
  userId: z.string().min(1),
  entries: z.array(entrySchema).min(1).max(MAX_ENTRIES),
})

const deleteSchema = z.object({
  userId: z.string().min(1),
  /**
   * Which caller erased, since apps/auth (account deletion) and apps/web (a
   * user clearing their own history) hit this route with otherwise identical
   * bodies. Optional so web's existing call keeps working; anything that must
   * treat a deletion differently — a tombstone, say — keys on this, never on
   * "DELETE was called".
   */
  reason: z.enum(["account-deleted", "history-cleared"]).optional(),
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

  // The analytics log is erased ONLY for an account deletion. apps/web calls
  // this same route for a user-initiated clear-history, which must remove the
  // resume positions without destroying that user's whole watch-event log.
  const erasesEvents = parsed.data.reason === "account-deleted"

  // One transaction: a partial erasure would leave apps/auth aborting the
  // deletion — and telling the user nothing changed — with rows already gone.
  const [result, events] = await prisma.$transaction(async (tx) => [
    await deleteWatchProgressForUser(parsed.data.userId, tx),
    erasesEvents
      ? await deleteWatchEventsForUser(tx, parsed.data.userId)
      : { deletedCount: 0 },
  ])
  console.warn(
    `[watch-progress] event=erasure reason=${parsed.data.reason ?? "unspecified"} progress=${result.deletedCount} events=${events.deletedCount}`,
  )
  return NextResponse.json({
    ...result,
    deletedWatchEventCount: events.deletedCount,
  })
}
