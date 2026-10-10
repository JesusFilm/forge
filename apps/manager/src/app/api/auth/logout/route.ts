import { NextResponse } from "next/server"

import {
  MANAGER_OAUTH_RETURN_TO_COOKIE,
  MANAGER_OAUTH_STATE_COOKIE,
  MANAGER_OAUTH_VERIFIER_COOKIE,
  MANAGER_SESSION_COOKIE,
} from "@/lib/manager-session-cookie"
import { getManagerBaseUrl } from "@/lib/oauth-client"

export function POST() {
  const response = NextResponse.json({ success: true })
  clearManagerSession(response)
  return response
}

export function GET() {
  const response = NextResponse.redirect(
    new URL("/api/auth/login?prompt=login", getManagerBaseUrl()),
  )
  clearManagerSession(response)
  return response
}

function clearManagerSession(response: NextResponse) {
  response.cookies.delete(MANAGER_SESSION_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_STATE_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_RETURN_TO_COOKIE)
  response.cookies.delete("strapi-jwt")
}
