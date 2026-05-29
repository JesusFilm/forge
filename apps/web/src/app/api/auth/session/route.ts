import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { verifyAuthSession, resolveAuthBaseURL } from "@/lib/auth-session"
import { evaluateDownloadAccountGate } from "@/lib/download-gate-flag"
import { resolveWatchCallbackURL } from "@/lib/watch-callback"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

function withRolloutCookie(
  response: NextResponse,
  setCookieHeader: string | undefined,
): NextResponse {
  if (setCookieHeader) response.headers.append("set-cookie", setCookieHeader)
  return response
}

export async function GET(request: Request): Promise<NextResponse> {
  const gate = await evaluateDownloadAccountGate(request)
  if (!gate.enabled) {
    return withRolloutCookie(
      NextResponse.json({ gateEnabled: false, authenticated: false }),
      gate.setCookieHeader,
    )
  }

  const session = await verifyAuthSession(request.headers)
  if (session.authenticated) {
    return withRolloutCookie(
      NextResponse.json({ gateEnabled: true, authenticated: true }),
      gate.setCookieHeader,
    )
  }

  const requestURL = new URL(request.url)
  const { searchParams } = requestURL
  const callbackURL = resolveWatchCallbackURL(searchParams.get("callbackURL"), [
    requestURL.origin,
  ])
  const authBase = resolveAuthBaseURL()
  if (!callbackURL || !authBase) {
    return withRolloutCookie(
      NextResponse.json({ error: "Invalid auth destination" }, { status: 400 }),
      gate.setCookieHeader,
    )
  }

  const loginUrl = new URL("/login", authBase)
  loginUrl.searchParams.set("callbackURL", callbackURL)

  return withRolloutCookie(
    NextResponse.json({
      authenticated: false,
      gateEnabled: true,
      loginUrl: loginUrl.toString(),
    }),
    gate.setCookieHeader,
  )
}
