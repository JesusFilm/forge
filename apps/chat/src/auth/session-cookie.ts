import { jwtVerify, SignJWT } from "jose"

import { chatAuthCookiePrefix, env, isRealSessionSecret } from "@/config/env"

import { ChatAuthError } from "./errors"

/**
 * Chat's signed, app-local session cookie (R5, R11 / KTD2, KTD4, KTD5). The
 * cookie IS the session: it carries the verified identity claims — chat has no
 * database. Adapted from apps/admin/src/auth/auth-session.ts (same jose
 * SignJWT/jwtVerify primitive + cookie-option helpers), but the payload is the
 * identity claims (not admin's {id, role, scopes}) and the TTL is short for
 * shared-device exposure (KTD5), not admin's 7-day staff-tool value.
 *
 * Fail-closed: with no real signing secret, create throws and read returns null
 * (anonymous) — an unsigned cookie is NEVER emitted or accepted.
 */
export type ChatIdentity = {
  sub: string
  name?: string
  email?: string
  picture?: string
}

/**
 * KTD5: short, shared-device-appropriate TTL — explicitly NOT admin's 7 days.
 * The cookie's own lifetime is authoritative; the id_token's ~1h exp is verified
 * once at callback and not carried onto the session (chat gates nothing, so
 * token freshness buys nothing — the claims are a display-only snapshot).
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 8
// Transient state/verifier/return_to cookies live only for the redirect round
// trip (R8) — deleted on callback.
export const TRANSIENT_TTL_SECONDS = 60 * 10

const prefix = chatAuthCookiePrefix()
export const CHAT_SESSION_COOKIE = `${prefix}_session`
export const CHAT_OAUTH_STATE_COOKIE = `${prefix}_oauth_state`
export const CHAT_OAUTH_VERIFIER_COOKIE = `${prefix}_oauth_verifier`
export const CHAT_OAUTH_RETURN_TO_COOKIE = `${prefix}_oauth_return_to`

/**
 * Sign the identity claims into a session cookie value (HS256, short TTL).
 * Throws `config_missing` when the signing secret is absent/placeholder/too
 * short — never signs with a guessable secret (R11 fail-closed).
 */
export async function createChatSessionCookie(
  identity: ChatIdentity,
): Promise<string> {
  return new SignJWT({
    sub: identity.sub,
    name: identity.name,
    email: identity.email,
    picture: identity.picture,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSigningKey())
}

/**
 * Verify a session cookie value and return the identity claims, or null for any
 * failure — missing/expired/tampered cookie, bad signature, or a missing
 * signing secret (fail-closed to anonymous, R11). Never throws.
 */
export async function readChatSessionCookie(
  value?: string,
): Promise<ChatIdentity | null> {
  if (!value) return null
  if (!isRealSessionSecret(env.CHAT_SESSION_SECRET)) return null

  try {
    const { payload } = await jwtVerify(value, getSigningKey(), {
      algorithms: ["HS256"],
    })
    if (typeof payload.sub !== "string") return null

    return {
      sub: payload.sub,
      name: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      picture:
        typeof payload.picture === "string" ? payload.picture : undefined,
    }
  } catch {
    return null
  }
}

/** Session-cookie attributes (R11): HttpOnly, Lax, Secure-in-prod, host-only, Path=/. */
export function chatSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    // NO `domain` — host-only, never the parent .jesusfilm.org (R11).
  }
}

/** Transient-cookie attributes: same hardening as the session, ~10-minute TTL (R8). */
export function transientCookieOptions() {
  return {
    ...chatSessionCookieOptions(),
    maxAge: TRANSIENT_TTL_SECONDS,
  }
}

function getSigningKey(): Uint8Array {
  const secret = env.CHAT_SESSION_SECRET
  if (!isRealSessionSecret(secret)) {
    throw new ChatAuthError("config_missing")
  }
  return new TextEncoder().encode(secret)
}
