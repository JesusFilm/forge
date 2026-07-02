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
  CHAT_OAUTH_RETURN_TO_COOKIE,
  CHAT_OAUTH_STATE_COOKIE,
  CHAT_OAUTH_VERIFIER_COOKIE,
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

  const response = NextResponse.redirect(
    buildChatAuthorizeUrl({
      config,
      state: state.state,
      codeChallenge: state.codeChallenge,
    }),
    302,
  )

  const options = transientCookieOptions()
  response.cookies.set(CHAT_OAUTH_STATE_COOKIE, state.state, options)
  response.cookies.set(CHAT_OAUTH_VERIFIER_COOKIE, state.codeVerifier, options)
  response.cookies.set(CHAT_OAUTH_RETURN_TO_COOKIE, returnTo, options)

  return response
}
