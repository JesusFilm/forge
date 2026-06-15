import { NextResponse } from "next/server"

import {
  isLocalMockManagerLoginEnabled,
  LOCAL_MOCK_MANAGER_SESSION,
} from "@/lib/mock-manager-login"
import {
  createManagerSessionCookie,
  MANAGER_SESSION_COOKIE,
  managerSessionCookieOptions,
} from "@/lib/manager-session-cookie"
import { getManagerBaseUrl } from "@/lib/oauth-client"

export async function GET(request: Request) {
  if (!isLocalMockManagerLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const managerBaseUrl = getManagerBaseUrl()
  const requestUrl = new URL(request.url)
  const returnTo = resolveManagerReturnToURL(
    requestUrl.searchParams.get("returnTo") ?? undefined,
    `${managerBaseUrl}/dashboard/coverage`,
    managerBaseUrl,
  )

  const response = NextResponse.redirect(returnTo)
  response.cookies.set(
    MANAGER_SESSION_COOKIE,
    await createManagerSessionCookie(LOCAL_MOCK_MANAGER_SESSION),
    managerSessionCookieOptions(),
  )

  return response
}

export const POST = GET

function resolveManagerReturnToURL(
  returnTo: string | undefined,
  fallbackURL: string,
  managerBaseUrl: string,
): string {
  if (!returnTo) return fallbackURL

  try {
    const parsed = new URL(returnTo, fallbackURL)
    return parsed.origin === new URL(managerBaseUrl).origin
      ? parsed.toString()
      : fallbackURL
  } catch {
    return fallbackURL
  }
}
