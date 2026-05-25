import { jwtVerify, SignJWT } from "jose"

import { env } from "@/config/env"

export const DEVELOPER_SESSION_COOKIE = "developer-session"
export const DEVELOPER_OAUTH_STATE_COOKIE = "developer-oauth-state"
export const DEVELOPER_OAUTH_VERIFIER_COOKIE = "developer-oauth-verifier"
export const DEVELOPER_OAUTH_RETURN_TO_COOKIE = "developer-oauth-return-to"

const maxAgeSeconds = 60 * 60 * 24 * 7

export type DeveloperSessionPrincipal = {
  subject: string
  email?: string
  name?: string
  scopes: string[]
}

export function createDeveloperSessionCookie(
  principal: DeveloperSessionPrincipal,
) {
  return new SignJWT(principal)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSigningKey())
}

export async function readDeveloperSessionCookie(
  value?: string,
): Promise<DeveloperSessionPrincipal | null> {
  if (!value) return null

  try {
    const { payload } = await jwtVerify(value, getSigningKey(), {
      algorithms: ["HS256"],
    })

    if (
      typeof payload.subject !== "string" ||
      (typeof payload.email !== "undefined" &&
        typeof payload.email !== "string") ||
      (typeof payload.name !== "undefined" &&
        typeof payload.name !== "string") ||
      !Array.isArray(payload.scopes) ||
      !payload.scopes.every((scope) => typeof scope === "string") ||
      !payload.scopes.includes("developer:access")
    ) {
      return null
    }

    return payload as DeveloperSessionPrincipal
  } catch {
    return null
  }
}

export function developerSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

export function developerOAuthCookieOptions() {
  return {
    ...developerSessionCookieOptions(),
    maxAge: 60 * 10,
  }
}

function getSigningKey() {
  return new TextEncoder().encode(env.DEVELOPER_SESSION_SECRET)
}
