/**
 * OAuth callback (F1, R8/R9/R10/R11/R12) — the security-critical step. Verifies
 * the returned state against the transient cookie, exchanges the code, verifies
 * the id_token (R9 — id-token-only, JWKS-derived alg allowlist, NO access-token
 * fallback), then sets the signed identity session cookie, consumes the
 * feat-240 force-login marker (success only — failures keep it armed so a
 * retry still forces a login page), and 302s to the validated return_to.
 * EVERY failure — bad state, missing verifier, token
 * exchange failure (incl. the outbound timeout), or verify failure — funnels
 * through ONE catch that logs a fixed non-PII reason code (KTD7), clears the
 * transient cookies, and 302s to the SAME validated return_to with the R12
 * marker (feat-209 — a failed sign-in from a /c/<id> deep link lands back on
 * the conversation, not home). Anonymous is the safe default; chat gates
 * nothing (R3/R7).
 */
import { NextResponse } from "next/server"

import { ChatAuthError, chatAuthErrorCode } from "@/auth/errors"
import {
  exchangeChatAuthorizationCode,
  getChatOAuthConfig,
  verifyChatIdToken,
} from "@/auth/oauth-client"
import { resolveChatReturnToURL } from "@/auth/origins"
import {
  CHAT_FORCE_LOGIN_COOKIE,
  CHAT_OAUTH_RETURN_TO_COOKIE,
  CHAT_OAUTH_STATE_COOKIE,
  CHAT_OAUTH_VERIFIER_COOKIE,
  CHAT_SESSION_COOKIE,
  chatSessionCookieOptions,
  createChatSessionCookie,
  readRequestCookie,
} from "@/auth/session-cookie"
import { SIGN_IN_ERROR_PARAM, SIGN_IN_ERROR_VALUE } from "@/auth/sign-in-notice"
import { chatAuthConfigured } from "@/config/env"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieHeader = request.headers.get("cookie")
  const expectedState = readRequestCookie(cookieHeader, CHAT_OAUTH_STATE_COOKIE)
  const codeVerifier = readRequestCookie(
    cookieHeader,
    CHAT_OAUTH_VERIFIER_COOKIE,
  )
  const returnTo = resolveChatReturnToURL(
    readRequestCookie(cookieHeader, CHAT_OAUTH_RETURN_TO_COOKIE),
  )

  try {
    if (!chatAuthConfigured()) {
      throw new ChatAuthError("config_missing")
    }
    if (!code || !state || !expectedState || state !== expectedState) {
      throw new ChatAuthError("state_mismatch")
    }
    if (!codeVerifier) {
      throw new ChatAuthError("missing_verifier")
    }

    const config = getChatOAuthConfig()
    const tokens = await exchangeChatAuthorizationCode({
      config,
      code,
      codeVerifier,
    })
    // R9: id_token ONLY — no access-token fallback, no user lookup, no gate.
    const identity = await verifyChatIdToken({
      config,
      idToken: tokens.id_token,
    })

    const response = NextResponse.redirect(returnTo, 302)
    response.cookies.set(
      CHAT_SESSION_COOKIE,
      await createChatSessionCookie({
        sub: identity.subject,
        name: identity.name,
        email: identity.email,
        picture: identity.picture,
        emailVerified: identity.emailVerified,
      }),
      chatSessionCookieOptions(),
    )
    clearTransientCookies(response)
    // feat-240: sign-in completed — consume the force-login marker. The catch
    // below keeps it armed so a failed/abandoned attempt still forces login.
    response.cookies.delete(CHAT_FORCE_LOGIN_COOKIE)
    return response
  } catch (error) {
    // KTD7: fixed reason CODE only — never the caught error's message (it can
    // embed token/claim fragments) and never any claim value.
    console.error(
      `[chat-auth] event=callback_failed reason=${chatAuthErrorCode(error)}`,
    )
    const response = NextResponse.redirect(withSignInError(returnTo), 302)
    clearTransientCookies(response)
    return response
  }
}

function clearTransientCookies(response: NextResponse) {
  response.cookies.delete(CHAT_OAUTH_STATE_COOKIE)
  response.cookies.delete(CHAT_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(CHAT_OAUTH_RETURN_TO_COOKIE)
}

/**
 * Append the R12 marker to an ALREADY-VALIDATED redirect target — the
 * resolveChatReturnToURL result (own-origin or chat home, R10). The URL API
 * preserves any query string the target already carries; this helper grants
 * no new redirect authority.
 */
function withSignInError(target: string): string {
  const url = new URL(target)
  url.searchParams.set(SIGN_IN_ERROR_PARAM, SIGN_IN_ERROR_VALUE)
  return url.toString()
}
