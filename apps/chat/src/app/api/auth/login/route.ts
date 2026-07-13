/**
 * Sign-in redirect (F1, R1/R8). Starts the authorization-code + PKCE flow:
 * mints per-request state + PKCE, stashes them (plus the validated return_to) in
 * hardened transient cookies, and 302s to apps/auth. When auth is unconfigured
 * (KTD6) it refuses to start a flow and just returns home — chat never exposes a
 * sign-in that dead-ends in a redirect_uri mismatch at the provider.
 *
 * ACCEPTED RISK (v1, see apps/chat/CLAUDE.md): this route is world-reachable and
 * drives an outbound call chain to apps/auth, and — like /api/seeker — ships
 * un-rate-limited. A per-IP cap is a prerequisite before the audience widens.
 */
import { NextResponse } from "next/server"

import { buildChatAuthorizeUrl, getChatOAuthConfig } from "@/auth/oauth-client"
import { createOAuthState } from "@/auth/oauth-state"
import { getChatHomeURL, resolveChatReturnToURL } from "@/auth/origins"
import {
  CHAT_FORCE_LOGIN_COOKIE,
  CHAT_OAUTH_RETURN_TO_COOKIE,
  CHAT_OAUTH_STATE_COOKIE,
  CHAT_OAUTH_VERIFIER_COOKIE,
  readRequestCookie,
  transientCookieOptions,
} from "@/auth/session-cookie"
import { chatAuthConfigured } from "@/config/env"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!chatAuthConfigured()) {
    return NextResponse.redirect(getChatHomeURL(), 302)
  }

  const config = getChatOAuthConfig()
  const url = new URL(request.url)
  const returnTo = resolveChatReturnToURL(
    url.searchParams.get("returnTo") ?? undefined,
  )
  const state = createOAuthState()
  // feat-240: the post-sign-out marker forces a real login page at apps/auth
  // (no silent SSO re-auth). Consumed by the callback's SUCCESS path only, so
  // a failed/abandoned attempt keeps forcing login. No ?prompt= passthrough.
  const forceLogin =
    readRequestCookie(
      request.headers.get("cookie"),
      CHAT_FORCE_LOGIN_COOKIE,
    ) !== undefined

  const response = NextResponse.redirect(
    buildChatAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
      prompt: forceLogin ? "login" : undefined,
    }),
    302,
  )

  const options = transientCookieOptions()
  response.cookies.set(CHAT_OAUTH_STATE_COOKIE, state.state, options)
  response.cookies.set(CHAT_OAUTH_VERIFIER_COOKIE, state.codeVerifier, options)
  response.cookies.set(CHAT_OAUTH_RETURN_TO_COOKIE, returnTo, options)

  return response
}
