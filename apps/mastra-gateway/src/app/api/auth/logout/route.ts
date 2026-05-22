import { NextResponse } from "next/server"

import {
  expiredGatewaySessionCookieOptions,
  GATEWAY_SESSION_COOKIE,
} from "@/lib/gateway-session"
import { getGatewayBaseUrl } from "@/config/env"

export async function GET() {
  const response = NextResponse.redirect(
    new URL("/api/auth/login", getGatewayBaseUrl()),
  )
  response.cookies.set(
    GATEWAY_SESSION_COOKIE,
    "",
    expiredGatewaySessionCookieOptions(),
  )
  return response
}
