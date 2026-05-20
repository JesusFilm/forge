import { NextResponse } from "next/server"

import {
  MANAGER_OAUTH_RETURN_TO_COOKIE,
  MANAGER_OAUTH_STATE_COOKIE,
  MANAGER_OAUTH_VERIFIER_COOKIE,
  MANAGER_SESSION_COOKIE,
} from "@/lib/manager-session-cookie"

export function POST(request: Request) {
  return clearManagerSession(request)
}

export function GET(request: Request) {
  return clearManagerSession(request)
}

function clearManagerSession(request: Request) {
  const response = NextResponse.redirect(
    new URL("/api/auth/login?prompt=login", request.url),
  )

  response.cookies.delete(MANAGER_SESSION_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_STATE_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_RETURN_TO_COOKIE)
  response.cookies.delete("strapi-jwt")

  return response
}
