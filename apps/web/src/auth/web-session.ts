import { createHash } from "node:crypto"

import { EncryptJWT, jwtDecrypt } from "jose"

import { env } from "@/env"

const webAuthCookiePrefix = "forge_web"
const maxAgeSeconds = 60 * 60 * 24 * 7

export const WEB_AUTH_SESSION_COOKIE = `${webAuthCookiePrefix}_session`
export const WEB_AUTH_STATE_COOKIE = `${webAuthCookiePrefix}_oauth_state`
export const WEB_AUTH_VERIFIER_COOKIE = `${webAuthCookiePrefix}_oauth_verifier`
export const WEB_AUTH_RETURN_TO_COOKIE = `${webAuthCookiePrefix}_oauth_return_to`
export const WEB_AUTH_FORCE_LOGIN_COOKIE = `${webAuthCookiePrefix}_force_login`

export type WebAuthSession = {
  subject: string
  email?: string
  name?: string
  image?: string
  scopes: string[]
  accessToken: string
  expiresAt?: number
}

type WebAuthSessionPayload = WebAuthSession & {
  kind: "web_auth_session"
}

export async function createWebAuthSessionCookie(session: WebAuthSession) {
  return new EncryptJWT({
    kind: "web_auth_session",
    subject: session.subject,
    email: session.email,
    name: session.name,
    image: session.image,
    scopes: session.scopes,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(getSessionKey())
}

export async function readWebAuthSessionCookie(
  value?: string,
): Promise<WebAuthSession | null> {
  if (!value) return null
  if (!env.WEB_SESSION_SECRET) return null

  try {
    const { payload } = await jwtDecrypt(value, getSessionKey(), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    })

    if (!isSessionPayload(payload)) return null
    if (
      payload.expiresAt &&
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null
    }

    return {
      subject: payload.subject,
      email: payload.email,
      name: payload.name,
      image: payload.image,
      scopes: payload.scopes,
      accessToken: payload.accessToken,
      expiresAt: payload.expiresAt,
    }
  } catch {
    return null
  }
}

export function webAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

export function requireWebSessionSecret() {
  if (!env.WEB_SESSION_SECRET) {
    throw new Error("WEB_SESSION_SECRET is required for Web sign-in.")
  }
}

function getSessionKey() {
  requireWebSessionSecret()
  const secret = env.WEB_SESSION_SECRET
  if (!secret) {
    throw new Error("WEB_SESSION_SECRET is required for Web sign-in.")
  }
  return createHash("sha256").update(secret).digest()
}

function isSessionPayload(
  payload: Record<string, unknown>,
): payload is WebAuthSessionPayload {
  return (
    payload.kind === "web_auth_session" &&
    typeof payload.subject === "string" &&
    typeof payload.accessToken === "string" &&
    Array.isArray(payload.scopes) &&
    payload.scopes.every((scope) => typeof scope === "string") &&
    (!("email" in payload) || typeof payload.email === "string") &&
    (!("name" in payload) || typeof payload.name === "string") &&
    (!("image" in payload) || typeof payload.image === "string") &&
    (!("expiresAt" in payload) || typeof payload.expiresAt === "number")
  )
}
