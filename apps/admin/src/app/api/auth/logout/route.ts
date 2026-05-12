import { NextResponse } from "next/server"

import {
  ADMIN_OAUTH_CALLBACK_COOKIE,
  ADMIN_OAUTH_SESSION_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_OAUTH_VERIFIER_COOKIE,
} from "@/auth/auth-session"

export function POST(request: Request) {
  return clearAdminOAuthCookies(request)
}

export function GET(request: Request) {
  return clearAdminOAuthCookies(request)
}

function clearAdminOAuthCookies(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url))

  response.cookies.delete(ADMIN_OAUTH_SESSION_COOKIE)
  response.cookies.delete(ADMIN_OAUTH_STATE_COOKIE)
  response.cookies.delete(ADMIN_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(ADMIN_OAUTH_CALLBACK_COOKIE)

  return response
}
