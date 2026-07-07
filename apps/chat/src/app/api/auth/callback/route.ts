/**
 * OAuth callback (F1, R8/R9/R10/R11/R12) — the security-critical step. Verifies
 * the returned state against the transient cookie, exchanges the code, verifies
 * the id_token (R9 — id-token-only, JWKS-derived alg allowlist, NO access-token
 * fallback), then sets the signed identity session cookie and 302s to the
 * validated return_to. EVERY failure — bad state, missing verifier, token
 * exchange failure (incl. the outbound timeout), or verify failure — funnels
 * through ONE catch that logs a fixed non-PII reason code (KTD7), clears the
 * transient cookies, and 302s home with the R12 marker. Anonymous is the safe
 * default; chat gates nothing (R3/R7).
 */
import { NextResponse } from "next/server"

import { ChatAuthError, chatAuthErrorCode } from "@/auth/errors"
import {
  exchangeChatAuthorizationCode,
  getChatOAuthConfig,
  verifyChatIdToken,
} from "@/auth/oauth-client"
import { getChatHomeURL, resolveChatReturnToURL } from "@/auth/origins"
import {
  CHAT_OAUTH_RETURN_TO_COOKIE,
  CHAT_OAUTH_STATE_COOKIE,
  CHAT_OAUTH_VERIFIER_COOKIE,
  CHAT_SESSION_COOKIE,
  chatSessionCookieOptions,
  createChatSessionCookie,
} from "@/auth/session-cookie"
import { SIGN_IN_ERROR_PARAM, SIGN_IN_ERROR_VALUE } from "@/auth/sign-in-notice"
import { chatAuthConfigured } from "@/config/env"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieHeader = request.headers.get("cookie")
  const expectedState = readCookie(cookieHeader, CHAT_OAUTH_STATE_COOKIE)
  const codeVerifier = readCookie(cookieHeader, CHAT_OAUTH_VERIFIER_COOKIE)
  const returnTo = resolveChatReturnToURL(
    readCookie(cookieHeader, CHAT_OAUTH_RETURN_TO_COOKIE),
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
      }),
      chatSessionCookieOptions(),
    )
    clearTransientCookies(response)
    return response
  } catch (error) {
    // KTD7: fixed reason CODE only — never the caught error's message (it can
    // embed token/claim fragments) and never any claim value.
    console.error(
      `[chat-auth] event=callback_failed reason=${chatAuthErrorCode(error)}`,
    )
    const response = NextResponse.redirect(homeWithSignInError(), 302)
    clearTransientCookies(response)
    return response
  }
}

function clearTransientCookies(response: NextResponse) {
  response.cookies.delete(CHAT_OAUTH_STATE_COOKIE)
  response.cookies.delete(CHAT_OAUTH_VERIFIER_COOKIE)
  response.cookies.delete(CHAT_OAUTH_RETURN_TO_COOKIE)
}

function homeWithSignInError(): string {
  const home = new URL(getChatHomeURL())
  home.searchParams.set(SIGN_IN_ERROR_PARAM, SIGN_IN_ERROR_VALUE)
  return home.toString()
}

/**
 * Read a cookie from the raw Cookie header. Decodes the value to mirror Next's
 * own RequestCookies read (NextResponse.cookies.set percent-encodes on write) —
 * a no-op for base64url state/verifier, load-bearing for the URL-valued
 * return_to. The decode is guarded because this runs BEFORE the callback's try,
 * so a throw on a malformed % sequence would 500 instead of failing closed.
 */
function readCookie(cookieHeader: string | null, name: string) {
  const raw = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  if (raw === undefined) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
