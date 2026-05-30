import { jwtVerify, SignJWT } from "jose"

import { env } from "@/config/env"

export const MANAGER_SESSION_COOKIE = "manager-session"
export const MANAGER_OAUTH_STATE_COOKIE = "manager-oauth-state"
export const MANAGER_OAUTH_VERIFIER_COOKIE = "manager-oauth-verifier"
export const MANAGER_OAUTH_RETURN_TO_COOKIE = "manager-oauth-return-to"

const maxAgeSeconds = 60 * 60 * 24 * 7

export type ManagerSessionPrincipal = {
  id: string
  subject: string
  email: string
  name?: string
  managerRole: "OPERATOR"
  scopes: string[]
}

export function createManagerSessionCookie(principal: ManagerSessionPrincipal) {
  return new SignJWT(principal)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSigningKey())
}

export async function readManagerSessionCookie(
  value?: string,
): Promise<ManagerSessionPrincipal | null> {
  if (!value) return null

  try {
    const { payload } = await jwtVerify(value, getSigningKey(), {
      algorithms: ["HS256"],
    })

    if (
      typeof payload.id !== "string" ||
      typeof payload.subject !== "string" ||
      typeof payload.email !== "string" ||
      (typeof payload.name !== "undefined" &&
        typeof payload.name !== "string") ||
      payload.managerRole !== "OPERATOR" ||
      !Array.isArray(payload.scopes) ||
      !payload.scopes.every((scope) => typeof scope === "string")
    ) {
      return null
    }

    return payload as ManagerSessionPrincipal
  } catch {
    return null
  }
}

export function managerSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

export function managerOAuthCookieOptions() {
  return {
    ...managerSessionCookieOptions(),
    maxAge: 60 * 10,
  }
}

function getSigningKey() {
  if (!env.MANAGER_SESSION_SECRET) {
    throw new Error("MANAGER_SESSION_SECRET is required for Manager sessions")
  }

  return new TextEncoder().encode(env.MANAGER_SESSION_SECRET)
}
