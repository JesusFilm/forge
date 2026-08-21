import type { ServerRuntime } from "next"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  WEB_AUTH_FORCE_LOGIN_COOKIE,
  WEB_AUTH_RETURN_TO_COOKIE,
  WEB_AUTH_STATE_COOKIE,
  WEB_AUTH_VERIFIER_COOKIE,
  requireWebSessionSecret,
  webAuthCookieOptions,
} from "@/auth/web-session"
import { buildWebAuthorizeUrl, getWebOAuthConfig } from "@/auth/oauth-client"
import { createOAuthState } from "@/auth/oauth-state"
import { getRequestOrigin } from "@/auth/request-origin"
import { normalizeWebReturnTo } from "@/auth/return-to"

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
  requireWebSessionSecret()

  const returnTo =
    normalizeWebReturnTo(url.searchParams.get("returnTo"), {
      requestOrigin,
      allowedOrigins: [config.webBaseUrl],
    }) ?? "/watch"
  const cookieStore = await cookies()
  const prompt =
    parsePrompt(url.searchParams.get("prompt")) ??
    (cookieStore.get(WEB_AUTH_FORCE_LOGIN_COOKIE) ? "login" : undefined)
  const state = createOAuthState()
  const response = NextResponse.redirect(
    buildWebAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      prompt,
    }),
  )
  const cookieOptions = webAuthCookieOptions()

  response.cookies.set(WEB_AUTH_STATE_COOKIE, state.state, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.set(WEB_AUTH_VERIFIER_COOKIE, state.codeVerifier, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.set(WEB_AUTH_RETURN_TO_COOKIE, returnTo, {
    ...cookieOptions,
    maxAge: 60 * 10,
  })
  response.cookies.delete(WEB_AUTH_FORCE_LOGIN_COOKIE)

  return response
}

function parsePrompt(
  prompt: string | null,
): "login" | "select_account" | undefined {
  return prompt === "login" || prompt === "select_account" ? prompt : undefined
}
