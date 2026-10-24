import { NextResponse } from "next/server"

import {
  ADMIN_OAUTH_RETURN_TO_COOKIE,
  ADMIN_OAUTH_STATE_COOKIE,
  ADMIN_OAUTH_VERIFIER_COOKIE,
  adminOAuthCookieOptions,
} from "@/auth/auth-session"
import {
  buildAdminAuthorizeUrl,
  getAdminOAuthConfig,
} from "@/auth/oauth-client"
import { createOAuthState } from "@/auth/oauth-state"
import { resolveAdminReturnToURL } from "@/auth/origins"

export async function GET(request: Request) {
  const config = getAdminOAuthConfig()
  const url = new URL(request.url)
  const returnTo = resolveAdminReturnToURL(
    url.searchParams.get("returnTo") ?? undefined,
    `${config.adminBaseUrl.replace(/\/$/, "")}/dashboard`,
  )
  const prompt = parsePrompt(url.searchParams.get("prompt"))
  const state = createOAuthState()
  const response = NextResponse.redirect(
    buildAdminAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      prompt,
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
  response.cookies.set(ADMIN_OAUTH_RETURN_TO_COOKIE, returnTo, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })

  return response
}

function parsePrompt(
  prompt: string | null,
): "login" | "select_account" | undefined {
  return prompt === "login" || prompt === "select_account" ? prompt : undefined
}
