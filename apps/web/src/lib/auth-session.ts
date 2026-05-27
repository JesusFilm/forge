import { env } from "@/env"

type AuthSessionResult =
  | { authenticated: true; userId: string }
  | { authenticated: false }

const AUTH_BASE_ALLOWED_HOSTS = new Set([
  "auth.jesusfilm.org",
  "auth-stage.jesusfilm.org",
  "localhost",
  "127.0.0.1",
])

function hasBetterAuthCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false
  return cookieHeader
    .split(";")
    .some((cookie) => cookie.trim().startsWith("better-auth.session"))
}

export function resolveAuthBaseURL(): URL | null {
  let url: URL
  try {
    url = new URL(env.WEB_AUTH_BASE_URL)
  } catch {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  if (!AUTH_BASE_ALLOWED_HOSTS.has(hostname)) return null
  if (
    process.env.NODE_ENV === "production" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    url.protocol !== "https:"
  ) {
    return null
  }

  return url
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms)
  }
  return undefined
}

export async function verifyAuthSession(
  headers: Headers,
): Promise<AuthSessionResult> {
  const cookieHeader = headers.get("cookie")
  if (!hasBetterAuthCookie(cookieHeader)) return { authenticated: false }

  const authBase = resolveAuthBaseURL()
  if (!authBase) return { authenticated: false }

  const url = new URL("/api/auth/get-session", authBase)
  url.searchParams.set("disableCookieCache", "true")
  url.searchParams.set("disableRefresh", "true")

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        cookie: cookieHeader ?? "",
      },
      signal: timeoutSignal(3_000),
    })
    if (!response.ok) return { authenticated: false }

    const body = (await response.json()) as {
      user?: { id?: unknown }
      session?: { userId?: unknown }
    } | null
    const userId =
      typeof body?.user?.id === "string"
        ? body.user.id
        : typeof body?.session?.userId === "string"
          ? body.session.userId
          : undefined

    return userId ? { authenticated: true, userId } : { authenticated: false }
  } catch {
    return { authenticated: false }
  }
}
