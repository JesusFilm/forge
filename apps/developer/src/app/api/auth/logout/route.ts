import { NextResponse } from "next/server"

import {
  DEVELOPER_OAUTH_RETURN_TO_COOKIE,
  DEVELOPER_OAUTH_STATE_COOKIE,
  DEVELOPER_OAUTH_VERIFIER_COOKIE,
  DEVELOPER_SESSION_COOKIE,
} from "@/lib/session-cookie"

export function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url))
  response.cookies.delete(DEVELOPER_SESSION_COOKIE)
  response.cookies.delete(DEVELOPER_OAUTH_STATE_COOKIE)
  response.cookies.delete(DEVELOPER_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(DEVELOPER_OAUTH_RETURN_TO_COOKIE)
  return response
}

export const POST = GET
