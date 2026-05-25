import { NextResponse } from "next/server"

import {
  buildDeveloperAuthorizeUrl,
  getDeveloperOAuthConfig,
} from "@/lib/oauth-client"
import { createOAuthState } from "@/lib/oauth-state"
import {
  DEVELOPER_OAUTH_RETURN_TO_COOKIE,
  DEVELOPER_OAUTH_STATE_COOKIE,
  DEVELOPER_OAUTH_VERIFIER_COOKIE,
  developerOAuthCookieOptions,
} from "@/lib/session-cookie"

export async function GET(request: Request) {
  const config = getDeveloperOAuthConfig()
  const url = new URL(request.url)
  const returnTo = resolveDeveloperReturnToURL(
    url.searchParams.get("returnTo") ?? undefined,
    config.developerBaseUrl,
  )
  const prompt = parsePrompt(url.searchParams.get("prompt"))
  const state = createOAuthState()
  const response = NextResponse.redirect(
    buildDeveloperAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      prompt,
    }),
  )
  const cookieOptions = developerOAuthCookieOptions()

  response.cookies.set(DEVELOPER_OAUTH_STATE_COOKIE, state.state, cookieOptions)
  response.cookies.set(
    DEVELOPER_OAUTH_VERIFIER_COOKIE,
    state.codeVerifier,
    cookieOptions,
  )
  response.cookies.set(
    DEVELOPER_OAUTH_RETURN_TO_COOKIE,
    returnTo,
    cookieOptions,
  )

  return response
}

function parsePrompt(
  prompt: string | null,
): "login" | "select_account" | undefined {
  return prompt === "login" || prompt === "select_account" ? prompt : undefined
}

function resolveDeveloperReturnToURL(
  returnTo: string | undefined,
  developerBaseUrl: string,
): string {
  const fallbackURL = developerBaseUrl.replace(/\/$/, "") || "/"
  if (!returnTo) return fallbackURL

  try {
    const parsed = new URL(returnTo, fallbackURL)
    return parsed.origin === new URL(developerBaseUrl).origin
      ? parsed.toString()
      : fallbackURL
  } catch {
    return fallbackURL
  }
}
