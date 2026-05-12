import { NextResponse } from "next/server"

import {
  ADMIN_OAUTH_CALLBACK_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_OAUTH_VERIFIER_COOKIE,
  adminOAuthCookieOptions,
} from "@/auth/auth-session"
import {
  buildAdminAuthorizeUrl,
  getAdminOAuthConfig,
} from "@/auth/oauth-client"
import { createOAuthState } from "@/auth/oauth-state"
import { resolveAuthCallbackURL } from "@/auth/origins"

export async function GET(request: Request) {
  const config = getAdminOAuthConfig()
  if (!config) {
    return NextResponse.redirect(new URL("/login?error=forbidden", request.url))
  }

  const url = new URL(request.url)
  const callbackURL = resolveAuthCallbackURL(
    url.searchParams.get("callbackURL") ?? undefined,
    `${config.adminBaseUrl.replace(/\/$/, "")}/dashboard`,
  )
  const state = createOAuthState()
  const response = NextResponse.redirect(
    buildAdminAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      callbackUrl: callbackURL,
    }),
  )
  const cookieOptions = adminOAuthCookieOptions()

  response.cookies.set(ADMIN_OAUTH_STATE_COOKIE, state.state, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.set(ADMIN_OAUTH_VERIFIER_COOKIE, state.codeVerifier, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.set(ADMIN_OAUTH_CALLBACK_COOKIE, callbackURL, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })

  return response
}
