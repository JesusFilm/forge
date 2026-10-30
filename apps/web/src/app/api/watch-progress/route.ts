import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"
import { z } from "zod"

import { verifyAuthSession } from "@/lib/auth-session"
import {
  deleteWatchProgressForUser,
  fetchWatchProgressForUser,
  syncWatchProgressForUser,
} from "@/lib/watch-progress-server"
import { fetchWatchHistoryVideoDetails } from "@/lib/watch-history"
import type { WatchProgressServerEntry } from "@/lib/watch-progress-server"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

const entrySchema = z.object({
  videoId: z.string().min(1),
  languageSlug: z.string().min(1).nullable().optional(),
  positionSeconds: z.number().finite().min(0),
  durationSeconds: z.number().finite().positive(),
  updatedAt: z.string().datetime(),
})

const syncSchema = z.object({
  entries: z.array(entrySchema).max(200).optional(),
  localUserId: z.string().min(1).nullable().optional(),
  includeVideos: z.boolean().optional(),
})

const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  vary: "Cookie",
} as const

function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS })
}

function mergeEntries(
  ...sources: WatchProgressServerEntry[][]
): WatchProgressServerEntry[] {
  const merged = new Map<string, WatchProgressServerEntry>()
  for (const source of sources) {
    for (const entry of source) {
      const current = merged.get(entry.videoId)
      if (
        !current ||
        Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt)
      ) {
        merged.set(entry.videoId, entry)
      }
    }
  }
  return Array.from(merged.values()).sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}

function entriesNewerThanCurrent({
  currentEntries,
  submittedEntries,
}: {
  currentEntries: WatchProgressServerEntry[]
  submittedEntries: WatchProgressServerEntry[]
}) {
  const currentByVideoId = new Map(
    currentEntries.map((entry) => [entry.videoId, entry]),
  )
  return mergeEntries(submittedEntries).filter((entry) => {
    const current = currentByVideoId.get(entry.videoId)
    return (
      !current || Date.parse(entry.updatedAt) >= Date.parse(current.updatedAt)
    )
  })
}

async function requireSession(request: Request) {
  const session = await verifyAuthSession(request.headers)
  return session.authenticated ? session : null
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return privateJson({
      authenticated: false,
      userId: null,
      entries: [],
    })
  }

  const entries = await fetchWatchProgressForUser(session.userId)
  return privateJson({
    authenticated: true,
    userId: session.userId,
    entries,
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return privateJson({ error: "Authentication required" }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return privateJson({ error: "Invalid JSON body" }, 400)
  }

  const parsed = syncSchema.safeParse(body)
  if (!parsed.success) {
    return privateJson({ error: "Invalid watch progress payload" }, 400)
  }

  const submittedEntries =
    parsed.data.localUserId == null ||
    parsed.data.localUserId === session.userId
      ? (parsed.data.entries ?? [])
      : []
  if (submittedEntries.length === 0 && parsed.data.includeVideos !== true) {
    return privateJson({ error: "Invalid watch progress payload" }, 400)
  }

  const currentEntries = await fetchWatchProgressForUser(session.userId)
  const entriesToSync = entriesNewerThanCurrent({
    currentEntries,
    submittedEntries,
  })
  const entries =
    entriesToSync.length > 0
      ? await syncWatchProgressForUser({
          userId: session.userId,
          entries: entriesToSync,
        })
      : []
  if (parsed.data.includeVideos !== true) {
    return privateJson({ entries })
  }

  const historyEntries = mergeEntries(currentEntries, entries, submittedEntries)
  const videos = await fetchWatchHistoryVideoDetails(historyEntries)
  return privateJson({
    authenticated: true,
    userId: session.userId,
    entries: historyEntries,
    videos,
  })
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const session = await requireSession(request)
  if (!session) {
    return privateJson({ error: "Authentication required" }, 401)
  }

  const ok = await deleteWatchProgressForUser(session.userId)
  return privateJson({ ok })
}
