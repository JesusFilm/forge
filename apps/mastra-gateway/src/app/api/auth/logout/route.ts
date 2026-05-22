import { NextResponse } from "next/server"

import {
  expiredGatewaySessionCookieOptions,
  GATEWAY_SESSION_COOKIE,
} from "@/lib/gateway-session"

export async function GET(request: Request) {
  const response = NextResponse.redirect(
    new URL("/api/auth/login", request.url),
  )
  response.cookies.set(
    GATEWAY_SESSION_COOKIE,
    "",
    expiredGatewaySessionCookieOptions(),
  )
  return response
}
