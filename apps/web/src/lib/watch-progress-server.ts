import { env } from "@/env"

const REQUEST_TIMEOUT_MS = 10_000

export type WatchProgressServerEntry = {
  videoId: string
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
  updatedAt: string
}

function watchProgressUrl(): string {
  return new URL(
    "/api/internal/watch-progress",
    env.ADMIN_GRAPHQL_URL,
  ).toString()
}

function adminBearer(): string {
  return (
    env.WATCH_PROGRESS_ADMIN_API_KEYS?.split(",")[0]?.trim() ??
    env.WEB_ADMIN_API_KEYS.split(",")[0]?.trim() ??
    ""
  )
}

async function adminFetch(path: string, init: RequestInit): Promise<Response> {
  const bearer = adminBearer()
  const headers = new Headers(init.headers)
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`)
  return fetch(`${watchProgressUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

export async function fetchWatchProgressForUser(
  userId: string,
): Promise<WatchProgressServerEntry[]> {
  const response = await adminFetch(
    `?userId=${encodeURIComponent(userId)}&limit=200`,
    { method: "GET" },
  )
  if (!response.ok) return []
  const body = (await response.json()) as { entries?: unknown }
  return Array.isArray(body.entries)
    ? body.entries.flatMap((entry): WatchProgressServerEntry[] =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as WatchProgressServerEntry).videoId === "string" &&
        ((entry as WatchProgressServerEntry).languageSlug == null ||
          typeof (entry as WatchProgressServerEntry).languageSlug ===
            "string") &&
        typeof (entry as WatchProgressServerEntry).positionSeconds ===
          "number" &&
        typeof (entry as WatchProgressServerEntry).durationSeconds ===
          "number" &&
        typeof (entry as WatchProgressServerEntry).updatedAt === "string"
          ? [entry as WatchProgressServerEntry]
          : [],
      )
    : []
}

export async function syncWatchProgressForUser({
  userId,
  entries,
}: {
  userId: string
  entries: WatchProgressServerEntry[]
}): Promise<WatchProgressServerEntry[]> {
  const response = await adminFetch("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, entries }),
  })
  if (!response.ok) return []
  const body = (await response.json()) as { entries?: unknown }
  return Array.isArray(body.entries)
    ? (body.entries as WatchProgressServerEntry[])
    : []
}

export async function deleteWatchProgressForUser(
  userId: string,
): Promise<boolean> {
  const response = await adminFetch("", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  })
  return response.ok
}
