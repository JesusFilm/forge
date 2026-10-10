import { NextResponse } from "next/server"

import {
  MANAGER_OAUTH_RETURN_TO_COOKIE,
  MANAGER_OAUTH_STATE_COOKIE,
  MANAGER_OAUTH_VERIFIER_COOKIE,
  managerOAuthCookieOptions,
} from "@/lib/manager-session-cookie"
import {
  buildManagerAuthorizeUrl,
  getManagerOAuthConfig,
} from "@/lib/oauth-client"
import { createOAuthState } from "@/lib/oauth-state"

export async function GET(request: Request) {
  const config = getManagerOAuthConfig()
  const url = new URL(request.url)
  const returnTo = resolveManagerReturnToURL(
    url.searchParams.get("returnTo") ?? undefined,
    `${config.managerBaseUrl.replace(/\/$/, "")}/dashboard/coverage`,
    config.managerBaseUrl,
  )
  const prompt = parsePrompt(url.searchParams.get("prompt"))
  const state = createOAuthState()
  const response = NextResponse.redirect(
    buildManagerAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      prompt,
    }),
  )
  const cookieOptions = managerOAuthCookieOptions()

  response.cookies.set(MANAGER_OAUTH_STATE_COOKIE, state.state, cookieOptions)
  response.cookies.set(
    MANAGER_OAUTH_VERIFIER_COOKIE,
    state.codeVerifier,
    cookieOptions,
  )
  response.cookies.set(MANAGER_OAUTH_RETURN_TO_COOKIE, returnTo, cookieOptions)

  return response
}

export const POST = GET

function parsePrompt(
  prompt: string | null,
): "login" | "select_account" | undefined {
  return prompt === "login" || prompt === "select_account" ? prompt : undefined
}

function resolveManagerReturnToURL(
  returnTo: string | undefined,
  fallbackURL: string,
  managerBaseUrl: string,
): string {
  if (!returnTo) return fallbackURL

  try {
    const parsed = new URL(returnTo, fallbackURL)
    return parsed.origin === new URL(managerBaseUrl).origin
      ? parsed.toString()
      : fallbackURL
  } catch {
    return fallbackURL
  }
}
