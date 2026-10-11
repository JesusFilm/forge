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

/**
 * These helpers already answer an unhealthy upstream with an empty list
 * (`if (!response.ok) return []`), but only for a response that arrives. The
 * `AbortSignal.timeout` above, a DNS or connection error, and a non-JSON body
 * all REJECT instead, skipping that contract entirely: the rejection escapes
 * `/api/watch-progress`, becomes a 500, and `watch-progress-client.ts` reads
 * any non-OK response as "not signed in" — the same silent sign-out FGE-185
 * fixed on the GraphQL fan-out. Failing soft here closes the second path to
 * it rather than choosing a new behaviour: `[]` is already what this function
 * returns when the upstream is unhealthy.
 */
async function softFetch<T>(
  label: string,
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read()
  } catch (error: unknown) {
    // Plain `event=` string, never JSON.stringify: Railway logsV2 silences
    // stringified payloads from Next.js route handlers. Type name only — a
    // rejected fetch's message can carry upstream body fragments.
    console.warn(
      `[watch-progress-server] event=${label} reason=${
        error instanceof Error ? error.name : typeof error
      }`,
    )
    return fallback
  }
}

export async function fetchWatchProgressForUser(
  userId: string,
): Promise<WatchProgressServerEntry[]> {
  return softFetch("progress_read_unavailable", () => readProgress(userId), [])
}

async function readProgress(
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

export async function syncWatchProgressForUser(args: {
  userId: string
  entries: WatchProgressServerEntry[]
}): Promise<WatchProgressServerEntry[]> {
  return softFetch("progress_write_unavailable", () => writeProgress(args), [])
}

async function writeProgress({
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
  return softFetch(
    "progress_delete_unavailable",
    () => runDelete(userId),
    false,
  )
}

async function runDelete(userId: string): Promise<boolean> {
  const response = await adminFetch("", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  })
  return response.ok
}
