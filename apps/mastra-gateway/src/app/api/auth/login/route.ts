import { NextResponse } from "next/server"

import {
  buildMastraStudioAuthorizeUrl,
  getMastraStudioOAuthConfig,
} from "@/lib/oauth-client"
import { createOAuthState } from "@/lib/oauth-state"
import {
  GATEWAY_OAUTH_RETURN_TO_COOKIE,
  GATEWAY_OAUTH_STATE_COOKIE,
  GATEWAY_OAUTH_VERIFIER_COOKIE,
  gatewaySessionCookieOptions,
} from "@/lib/gateway-session"

export async function GET(request: Request) {
  const config = getMastraStudioOAuthConfig()
  const url = new URL(request.url)
  const returnTo = resolveReturnTo(url.searchParams.get("returnTo"))
  const prompt = parsePrompt(url.searchParams.get("prompt"))
  const state = createOAuthState()

  const response = NextResponse.redirect(
    buildMastraStudioAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      prompt,
    }),
  )
  const cookieOptions = gatewaySessionCookieOptions()

  response.cookies.set(GATEWAY_OAUTH_STATE_COOKIE, state.state, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.set(GATEWAY_OAUTH_VERIFIER_COOKIE, state.codeVerifier, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.set(GATEWAY_OAUTH_RETURN_TO_COOKIE, returnTo, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })

  return response
}

function resolveReturnTo(returnTo: string | null) {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/studio"
  }
  return returnTo
}

function parsePrompt(
  prompt: string | null,
): "login" | "select_account" | undefined {
  return prompt === "login" || prompt === "select_account" ? prompt : undefined
}
