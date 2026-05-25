import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  exchangeDeveloperAuthorizationCode,
  getDeveloperOAuthConfig,
  verifyDeveloperIdToken,
} from "@/lib/oauth-client"
import {
  createDeveloperSessionCookie,
  DEVELOPER_OAUTH_RETURN_TO_COOKIE,
  DEVELOPER_OAUTH_STATE_COOKIE,
  DEVELOPER_OAUTH_VERIFIER_COOKIE,
  DEVELOPER_SESSION_COOKIE,
  developerSessionCookieOptions,
} from "@/lib/session-cookie"

export async function GET(request: Request) {
  const config = getDeveloperOAuthConfig()
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(DEVELOPER_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(DEVELOPER_OAUTH_VERIFIER_COOKIE)?.value
  const returnTo =
    cookieStore.get(DEVELOPER_OAUTH_RETURN_TO_COOKIE)?.value ??
    config.developerBaseUrl

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    return redirectToLogin(request, "invalid_state")
  }

  try {
    const tokenResponse = await exchangeDeveloperAuthorizationCode({
      config,
      code,
      codeVerifier,
    })
    const verifiedToken = await verifyDeveloperIdToken({
      config,
      idToken: tokenResponse.id_token,
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
    })

    const response = NextResponse.redirect(new URL(returnTo, request.url))
    response.cookies.set(
      DEVELOPER_SESSION_COOKIE,
      await createDeveloperSessionCookie({
        subject: verifiedToken.subject,
        email: verifiedToken.email,
        name: verifiedToken.name,
        scopes: verifiedToken.scopes,
      }),
      developerSessionCookieOptions(),
    )
    response.cookies.delete(DEVELOPER_OAUTH_STATE_COOKIE)
    response.cookies.delete(DEVELOPER_OAUTH_VERIFIER_COOKIE)
    response.cookies.delete(DEVELOPER_OAUTH_RETURN_TO_COOKIE)

    return response
  } catch (error) {
    console.warn("developer.oauth.callback.forbidden", {
      reason: "callback_failed",
      message: error instanceof Error ? error.message : "unknown",
    })

    return redirectToLogin(request, "callback_failed")
  }
}

function redirectToLogin(request: Request, reason: string) {
  const response = NextResponse.redirect(
    new URL(`/api/auth/login?error=${encodeURIComponent(reason)}`, request.url),
  )
  response.cookies.delete(DEVELOPER_SESSION_COOKIE)
  response.cookies.delete(DEVELOPER_OAUTH_STATE_COOKIE)
  response.cookies.delete(DEVELOPER_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(DEVELOPER_OAUTH_RETURN_TO_COOKIE)
  return response
}
