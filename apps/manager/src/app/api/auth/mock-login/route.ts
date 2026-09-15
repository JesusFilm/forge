import { NextResponse } from "next/server"

import {
  isLocalMockManagerLoginEnabled,
  LOCAL_MOCK_MANAGER_SESSION,
  LOCAL_MOCK_REVIEWER_SESSION,
} from "@/lib/mock-manager-login"
import { resolveRoleCompatibleManagerReturnToURL } from "@/lib/manager-route-access"
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
  const requestedReturnTo = requestUrl.searchParams.get("returnTo") ?? undefined
  const reviewerRequested =
    requestUrl.searchParams.get("role") === "reviewer" ||
    requestedReturnTo === "/subtitle-review" ||
    requestedReturnTo?.startsWith("/subtitle-review/")
  const principal = reviewerRequested
    ? LOCAL_MOCK_REVIEWER_SESSION
    : LOCAL_MOCK_MANAGER_SESSION
  const returnTo = resolveRoleCompatibleManagerReturnToURL({
    returnTo: requestedReturnTo,
    role: principal.managerRole,
    managerBaseUrl,
  })

  const response = NextResponse.redirect(returnTo)
  response.cookies.set(
    MANAGER_SESSION_COOKIE,
    await createManagerSessionCookie(principal),
    managerSessionCookieOptions(),
  )

  return response
}

export const POST = GET
