import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import {
  WEB_AUTH_RETURN_TO_COOKIE,
  WEB_AUTH_FORCE_LOGIN_COOKIE,
  WEB_AUTH_SESSION_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
  clearWebAuthCookie,
  webAuthCookieOptions,
} from "@/auth/web-session"
import { getRequestOrigin } from "@/auth/request-origin"
import { resolveWatchCallbackURL } from "@/lib/watch-callback"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

export function POST(request: Request) {
  return clearWebAuthCookies(request)
}

export function GET(request: Request) {
  return clearWebAuthCookies(request)
}

function clearWebAuthCookies(request: Request) {
  const url = new URL(request.url)
  const requestOrigin = getRequestOrigin(request)
  const returnTo =
    resolveWatchCallbackURL(
      toAbsoluteWatchURL(url.searchParams.get("returnTo"), requestOrigin),
      [requestOrigin],
    ) ?? new URL("/watch", requestOrigin).toString()
  const response = NextResponse.redirect(returnTo)

  // Set first: the cookies API rewrites the Set-Cookie header from its own
  // name-keyed map, which would drop the raw legacy lines appended below.
  response.cookies.set(WEB_AUTH_FORCE_LOGIN_COOKIE, "1", {
    ...webAuthCookieOptions(),
    maxAge: 60 * 10,
  })

  for (const name of [
    WEB_AUTH_SESSION_COOKIE,
    WEB_AUTH_STATE_COOKIE,
    WEB_AUTH_VERIFIER_COOKIE,
    WEB_AUTH_RETURN_TO_COOKIE,
  ]) {
    clearWebAuthCookie(response.headers, name)
  }

  return response
}

function toAbsoluteWatchURL(value: string | null, origin: string) {
  if (!value) return value
  try {
    return new URL(value, origin).toString()
  } catch {
    return value
  }
}
