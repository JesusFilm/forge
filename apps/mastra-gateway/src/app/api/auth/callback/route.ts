import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  exchangeMastraStudioAuthorizationCode,
  getMastraStudioOAuthConfig,
  verifyMastraStudioIdToken,
} from "@/lib/oauth-client"
import { getGatewayBaseUrl } from "@/config/env"
import {
  createGatewaySessionCookie,
  expiredGatewaySessionCookieOptions,
  GATEWAY_OAUTH_RETURN_TO_COOKIE,
  GATEWAY_OAUTH_STATE_COOKIE,
  GATEWAY_OAUTH_VERIFIER_COOKIE,
  GATEWAY_SESSION_COOKIE,
  gatewaySessionCookieOptions,
} from "@/lib/gateway-session"
import { createGatewayStudioAccessService } from "@/services/studio-access.factory"

export async function GET(request: Request) {
  const config = getMastraStudioOAuthConfig()
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(GATEWAY_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(GATEWAY_OAUTH_VERIFIER_COOKIE)?.value
  const returnTo =
    cookieStore.get(GATEWAY_OAUTH_RETURN_TO_COOKIE)?.value ?? "/studio"

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    return redirectToAccessRequested("forbidden")
  }

  try {
    const tokenResponse = await exchangeMastraStudioAuthorizationCode({
      config,
      code,
      codeVerifier,
    })
    const verifiedToken = await verifyMastraStudioIdToken({
      config,
      idToken: tokenResponse.id_token,
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
    })
    const access = await createGatewayStudioAccessService().resolve({
      subject: verifiedToken.subject,
      email: verifiedToken.email,
      name: verifiedToken.name,
    })

    if (!access.allowed) {
      return redirectToAccessRequested(access.reason)
    }

    const response = NextResponse.redirect(
      new URL(returnTo, getGatewayBaseUrl()),
    )
    response.cookies.set(
      GATEWAY_SESSION_COOKIE,
      await createGatewaySessionCookie({
        subject: verifiedToken.subject,
        email: verifiedToken.email,
        name: verifiedToken.name,
        role: access.role,
      }),
      gatewaySessionCookieOptions(),
    )
    clearOAuthCookies(response)

    return response
  } catch (error) {
    console.warn("mastra.gateway.oauth.callback_failed", {
      message: error instanceof Error ? error.message : "unknown",
    })

    return redirectToAccessRequested("forbidden")
  }
}

function redirectToAccessRequested(reason: string) {
  const url = new URL("/access-requested", getGatewayBaseUrl())
  url.searchParams.set("reason", reason)
  const response = NextResponse.redirect(url)
  clearOAuthCookies(response)
  return response
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set(
    GATEWAY_OAUTH_STATE_COOKIE,
    "",
    expiredGatewaySessionCookieOptions(),
  )
  response.cookies.set(
    GATEWAY_OAUTH_VERIFIER_COOKIE,
    "",
    expiredGatewaySessionCookieOptions(),
  )
  response.cookies.set(
    GATEWAY_OAUTH_RETURN_TO_COOKIE,
    "",
    expiredGatewaySessionCookieOptions(),
  )
}
