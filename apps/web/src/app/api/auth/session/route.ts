import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { verifyAuthSession } from "@/lib/auth-session"
import { getRequestOrigin } from "@/auth/request-origin"
import {
  isWatchDownloadAccountGateEnabled,
  watchDownloadAccountGateFlagContext,
} from "@/lib/feature-flags"
import { resolveWatchCallbackURL } from "@/lib/watch-callback"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<NextResponse> {
  const session = await verifyAuthSession(request.headers)
  const requestURL = new URL(request.url)
  const requestOrigin = getRequestOrigin(request)
  const accountGateEnabled = await isWatchDownloadAccountGateEnabled(
    watchDownloadAccountGateFlagContext,
  )

  if (session.authenticated) {
    return NextResponse.json({
      accountGateEnabled,
      authenticated: true,
      user: session.user,
    })
  }

  const { searchParams } = requestURL
  const callbackURL = resolveWatchCallbackURL(
    toAbsoluteWatchURL(searchParams.get("callbackURL"), requestOrigin),
    [requestOrigin],
  )
  if (!callbackURL) {
    return NextResponse.json(
      { error: "Invalid auth destination" },
      { status: 400 },
    )
  }

  const loginUrl = new URL("/watch/api/auth/login", requestOrigin)
  loginUrl.searchParams.set("returnTo", callbackURL)

  return NextResponse.json({
    accountGateEnabled,
    authenticated: false,
    loginUrl: loginUrl.toString(),
  })
}

function toAbsoluteWatchURL(value: string | null, origin: string) {
  if (!value) return value
  try {
    return new URL(value, origin).toString()
  } catch {
    return value
  }
}
