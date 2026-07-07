import type { ServerRuntime } from "next"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  WEB_AUTH_RETURN_TO_COOKIE,
  WEB_AUTH_SESSION_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
  createWebAuthSessionCookie,
  webAuthCookieOptions,
} from "@/auth/web-session"
import { getRequestOrigin } from "@/auth/request-origin"
import {
  exchangeWebAuthorizationCode,
  getWebOAuthConfig,
  verifyWebIdToken,
} from "@/auth/oauth-client"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const requestOrigin = getRequestOrigin(request)
  const config = getWebOAuthConfig({ requestOrigin })
  if (!config) {
    return NextResponse.json(
      { error: "Web sign-in is unavailable" },
      { status: 503 },
    )
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(WEB_AUTH_STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(WEB_AUTH_VERIFIER_COOKIE)?.value
  const returnTo =
    cookieStore.get(WEB_AUTH_RETURN_TO_COOKIE)?.value ??
    `${config.webBaseUrl}/watch`

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    console.warn("web.oauth.callback.rejected reason=invalid_state")
    return redirectToAuthError(returnTo, "invalid_state")
  }

  try {
    const tokenResponse = await exchangeWebAuthorizationCode({
      config,
      code,
      codeVerifier,
    })
    const verifiedToken = await verifyWebIdToken({
      config,
      idToken: tokenResponse.id_token,
      scope: tokenResponse.scope,
    })
    const now = Math.floor(Date.now() / 1000)
    const response = NextResponse.redirect(new URL(returnTo, request.url))
    response.cookies.set(
      WEB_AUTH_SESSION_COOKIE,
      await createWebAuthSessionCookie({
        subject: verifiedToken.subject,
        email: verifiedToken.email,
        name: verifiedToken.name,
        image: verifiedToken.image,
        scopes: verifiedToken.scopes,
        accessToken: tokenResponse.access_token,
        expiresAt: tokenResponse.expires_in
          ? now + tokenResponse.expires_in
          : undefined,
      }),
      webAuthCookieOptions(),
    )
    response.cookies.delete(WEB_AUTH_STATE_COOKIE)
    response.cookies.delete(WEB_AUTH_VERIFIER_COOKIE)
    response.cookies.delete(WEB_AUTH_RETURN_TO_COOKIE)

    return response
  } catch (error) {
    console.warn(
      `web.oauth.callback.rejected reason=callback_failed message=${
        error instanceof Error ? error.message : "unknown"
      }`,
    )
    return redirectToAuthError(returnTo, "callback_failed")
  }
}

function redirectToAuthError(returnTo: string, reason: string) {
  const url = new URL(returnTo)
  url.searchParams.set("auth", "failed")
  url.searchParams.set("reason", reason)
  const response = NextResponse.redirect(url)
  response.cookies.delete(WEB_AUTH_STATE_COOKIE)
  response.cookies.delete(WEB_AUTH_VERIFIER_COOKIE)
  response.cookies.delete(WEB_AUTH_RETURN_TO_COOKIE)
  return response
}
