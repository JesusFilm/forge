import { NextRequest, NextResponse } from "next/server"
import {
  getAuthBaseURL,
  getDefaultPostLoginURL,
  resolveAuthCallbackURL,
} from "@/auth/origins"

const AUTH_HOST_ALLOWED_PATH_PREFIXES = [
  "/api/auth",
  "/_next",
  "/images/",
] as const

const AUTH_HOST_ALLOWED_PATHS = new Set(["/login", "/favicon.ico"])

function getRequestOrigin(request: NextRequest): string | undefined {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!host) {
    return undefined
  }

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
  const proto =
    forwardedProto ?? (host.startsWith("localhost") ? "http" : "https")

  return `${proto}://${host}`
}

function isAuthHostAllowedPath(pathname: string): boolean {
  return (
    AUTH_HOST_ALLOWED_PATHS.has(pathname) ||
    AUTH_HOST_ALLOWED_PATH_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix),
    )
  )
}

function redirectAuthRootToLogin(request: NextRequest, authBaseURL: string) {
  const loginURL = new URL("/login", authBaseURL)
  loginURL.searchParams.set(
    "callbackURL",
    resolveAuthCallbackURL(
      request.nextUrl.searchParams.get("callbackURL") ?? undefined,
    ),
  )

  return NextResponse.redirect(loginURL)
}

function redirectAuthPageToAdmin(request: NextRequest) {
  const adminURL = new URL(getDefaultPostLoginURL())
  adminURL.pathname = request.nextUrl.pathname
  adminURL.search = request.nextUrl.search

  // Single-origin (dev / single-host) mode: when AUTH_TRUSTED_ORIGINS
  // resolves to the same origin as BETTER_AUTH_URL, the auth host and
  // admin host are the same process and a redirect would loop.
  if (adminURL.origin === getAuthBaseURL()) {
    return NextResponse.next()
  }

  return NextResponse.redirect(adminURL)
}

export function proxy(request: NextRequest) {
  const authBaseURL = getAuthBaseURL()

  if (getRequestOrigin(request) !== authBaseURL) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  // Single-origin (dev / single-host) mode: when the admin host and the auth
  // host share an origin, the auth-host firewall rules below would block
  // admin's own APIs (everything outside /api/auth) and trap the editor in a
  // redirect loop. Pass through and let the route handlers decide.
  const adminURL = new URL(getDefaultPostLoginURL())
  if (adminURL.origin === authBaseURL) {
    return NextResponse.next()
  }

  if (pathname === "/") {
    return redirectAuthRootToLogin(request, authBaseURL)
  }

  if (isAuthHostAllowedPath(pathname)) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/")) {
    return new NextResponse("Not found", { status: 404 })
  }

  return redirectAuthPageToAdmin(request)
}
