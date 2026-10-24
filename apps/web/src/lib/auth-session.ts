import { env } from "@/env"
import {
  WEB_AUTH_SESSION_COOKIE,
  readWebAuthSessionCookie,
} from "@/auth/web-session"

type AuthSessionResult =
  | {
      authenticated: true
      userId: string
      accessToken?: string
      user?: {
        id: string
        email?: string
        name?: string
        image?: string
      }
    }
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

function getCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1)
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
  if (process.env.NODE_ENV === "production") {
    if (hostname === "localhost" || hostname === "127.0.0.1") return null
    if (url.protocol !== "https:") return null
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
  const webSession = await readWebAuthSessionCookie(
    getCookieValue(cookieHeader, WEB_AUTH_SESSION_COOKIE),
  )
  if (webSession) {
    return {
      authenticated: true,
      userId: webSession.subject,
      accessToken: webSession.accessToken,
      user: {
        id: webSession.subject,
        email: webSession.email,
        name: webSession.name,
        image: webSession.image,
      },
    }
  }

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
      user?: { id?: unknown; email?: unknown; name?: unknown; image?: unknown }
      session?: { userId?: unknown }
    } | null
    const userId =
      typeof body?.user?.id === "string"
        ? body.user.id
        : typeof body?.session?.userId === "string"
          ? body.session.userId
          : undefined

    return userId
      ? {
          authenticated: true,
          userId,
          user: {
            id: userId,
            email:
              typeof body?.user?.email === "string"
                ? body.user.email
                : undefined,
            name:
              typeof body?.user?.name === "string" ? body.user.name : undefined,
            image:
              typeof body?.user?.image === "string"
                ? body.user.image
                : undefined,
          },
        }
      : { authenticated: false }
  } catch {
    return { authenticated: false }
  }
}
