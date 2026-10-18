import { env } from "@/env"

const REQUEST_TIMEOUT_MS = 5_000
// Mirrors Admin's dedicated Watch SEO contract. Keep this separate from the
// service-key Authorization header.
const USER_AUTHORIZATION_HEADER = "x-watch-user-authorization"

function firstWatchSeoKey(): string | null {
  return env.WATCH_SEO_API_KEYS?.split(",")[0]?.trim() || null
}

function adminUrl(path: string, query?: URLSearchParams): string {
  const url = new URL(`/api/watch-seo/${path}`, env.ADMIN_GRAPHQL_URL)
  if (query) url.search = query.toString()
  return url.toString()
}

export async function fetchWatchSeoAdmin(
  path: "capability" | "read-model",
  accessToken: string,
  init: RequestInit = {},
  query?: URLSearchParams,
): Promise<Response | null> {
  const serviceKey = firstWatchSeoKey()
  if (!serviceKey || !accessToken) return null

  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${serviceKey}`)
  headers.set(USER_AUTHORIZATION_HEADER, `Bearer ${accessToken}`)
  headers.set("accept", "application/json")

  try {
    return await fetch(adminUrl(path, query), {
      ...init,
      method: init.method ?? "POST",
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return null
  }
}
