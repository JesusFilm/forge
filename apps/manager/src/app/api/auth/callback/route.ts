import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { validateAdminManagerSession } from "@/lib/admin-manager-session"
import {
  createManagerSessionCookie,
  MANAGER_OAUTH_RETURN_TO_COOKIE,
  MANAGER_OAUTH_STATE_COOKIE,
  MANAGER_OAUTH_VERIFIER_COOKIE,
  MANAGER_SESSION_COOKIE,
  managerSessionCookieOptions,
} from "@/lib/manager-session-cookie"
import { resolveRoleCompatibleManagerReturnToURL } from "@/lib/manager-route-access"
import {
  exchangeManagerAuthorizationCode,
  getManagerOAuthConfig,
  verifyManagerIdToken,
} from "@/lib/oauth-client"

export async function GET(request: Request) {
  const config = getManagerOAuthConfig()
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(MANAGER_OAUTH_STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(MANAGER_OAUTH_VERIFIER_COOKIE)?.value
  const requestedReturnTo = cookieStore.get(
    MANAGER_OAUTH_RETURN_TO_COOKIE,
  )?.value

  if (
    !code ||
    !state ||
    !expectedState ||
    state !== expectedState ||
    !codeVerifier
  ) {
    return redirectToLogin(config.managerBaseUrl, "invalid_state")
  }

  try {
    const tokenResponse = await exchangeManagerAuthorizationCode({
      config,
      code,
      codeVerifier,
    })
    const verifiedToken = await verifyManagerIdToken({
      config,
      idToken: tokenResponse.id_token,
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
    })
    const adminSession = await validateAdminManagerSession({
      subject: verifiedToken.subject,
      email: verifiedToken.email,
      name: verifiedToken.name,
    })

    if (!adminSession) {
      return redirectToLogin(config.managerBaseUrl, "forbidden")
    }

    const returnTo = resolveRoleCompatibleManagerReturnToURL({
      returnTo: requestedReturnTo,
      role: adminSession.managerRole,
      managerBaseUrl: config.managerBaseUrl,
    })
    const response = NextResponse.redirect(new URL(returnTo, request.url))
    response.cookies.set(
      MANAGER_SESSION_COOKIE,
      await createManagerSessionCookie({
        id: adminSession.user.id,
        subject: verifiedToken.subject,
        email: adminSession.user.email,
        name: adminSession.user.name ?? verifiedToken.name,
        managerRole: adminSession.managerRole,
        scopes: verifiedToken.scopes,
        reviewerLanguageGrants: adminSession.reviewerLanguageGrants,
      }),
      managerSessionCookieOptions(),
    )
    response.cookies.delete(MANAGER_OAUTH_STATE_COOKIE)
    response.cookies.delete(MANAGER_OAUTH_VERIFIER_COOKIE)
    response.cookies.delete(MANAGER_OAUTH_RETURN_TO_COOKIE)
    response.cookies.delete("strapi-jwt")

    return response
  } catch (error) {
    console.warn("manager.oauth.callback.forbidden", {
      reason: "callback_failed",
      message: error instanceof Error ? error.message : "unknown",
    })

    return redirectToLogin(config.managerBaseUrl, "callback_failed")
  }
}

function redirectToLogin(managerBaseUrl: string, reason: string) {
  const response = NextResponse.redirect(
    new URL(
      `/login?error=${encodeURIComponent(reason)}`,
      managerBaseUrl.replace(/\/$/, ""),
    ),
  )
  response.cookies.delete(MANAGER_SESSION_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_STATE_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(MANAGER_OAUTH_RETURN_TO_COOKIE)
  response.cookies.delete("strapi-jwt")
  return response
}
