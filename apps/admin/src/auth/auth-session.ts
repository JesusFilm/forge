import { jwtVerify, SignJWT } from "jose"

import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"

const adminOAuthCookiePrefix = env.AUTH_COOKIE_PREFIX?.trim() || "forge_admin"

export const ADMIN_OAUTH_SESSION_COOKIE = `${adminOAuthCookiePrefix}_oauth_session`
export const ADMIN_OAUTH_STATE_COOKIE = `${adminOAuthCookiePrefix}_oauth_state`
export const ADMIN_OAUTH_VERIFIER_COOKIE = `${adminOAuthCookiePrefix}_oauth_verifier`
export const ADMIN_OAUTH_RETURN_TO_COOKIE = `${adminOAuthCookiePrefix}_oauth_return_to`
export const ADMIN_OAUTH_ACCESS_REQUEST_COOKIE = `${adminOAuthCookiePrefix}_oauth_access_request`

const maxAgeSeconds = 60 * 60 * 24 * 7
const accessRequestMaxAgeSeconds = 60 * 60 * 24

type AdminOAuthSessionPayload = Principal & {
  scopes: string[]
  iat?: number
}

export type AdminOAuthAccessRequestPayload = {
  subject: string
  email?: string
  name?: string
}

export type AdminOAuthSessionDetails = {
  principal: Principal
  authenticatedAt: Date | null
}

export function createAdminOAuthSessionCookie(
  principal: Principal,
  scopes: string[],
) {
  return new SignJWT({
    id: principal.id,
    role: principal.role,
    scopes,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSigningKey())
}

export function createAdminOAuthAccessRequestCookie(
  payload: AdminOAuthAccessRequestPayload,
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${accessRequestMaxAgeSeconds}s`)
    .sign(getSigningKey())
}

export async function readAdminOAuthSessionCookie(
  value?: string,
): Promise<Principal | null> {
  return (await readAdminOAuthSessionDetails(value))?.principal ?? null
}

export async function readAdminOAuthSessionDetails(
  value?: string,
): Promise<AdminOAuthSessionDetails | null> {
  if (!value) return null

  const payload = await verifyPayload(value)
  if (!payload) {
    return null
  }

  return {
    principal: { id: payload.id, role: payload.role },
    authenticatedAt:
      typeof payload.iat === "number" ? new Date(payload.iat * 1_000) : null,
  }
}

export async function readAdminOAuthAccessRequestCookie(
  value?: string,
): Promise<AdminOAuthAccessRequestPayload | null> {
  if (!value) return null

  try {
    const { payload } = await jwtVerify(value, getSigningKey(), {
      algorithms: ["HS256"],
    })

    if (
      typeof payload.subject !== "string" ||
      ("email" in payload && typeof payload.email !== "string") ||
      ("name" in payload && typeof payload.name !== "string")
    ) {
      return null
    }

    const email = typeof payload.email === "string" ? payload.email : undefined
    const name = typeof payload.name === "string" ? payload.name : undefined

    return {
      subject: payload.subject,
      email,
      name,
    }
  } catch {
    return null
  }
}

export function adminOAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

export function adminOAuthAccessRequestCookieOptions() {
  return {
    ...adminOAuthCookieOptions(),
    maxAge: accessRequestMaxAgeSeconds,
  }
}

async function verifyPayload(
  value: string,
): Promise<AdminOAuthSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(value, getSigningKey(), {
      algorithms: ["HS256"],
    })

    if (
      typeof payload.id !== "string" ||
      !isPrincipalRole(payload.role) ||
      !Array.isArray(payload.scopes) ||
      !payload.scopes.every((scope) => typeof scope === "string")
    ) {
      return null
    }

    return payload as AdminOAuthSessionPayload
  } catch {
    return null
  }
}

function isPrincipalRole(role: unknown): role is Principal["role"] {
  return role === "ADMIN" || role === "EDITOR" || role === "VIEWER"
}

function getSigningKey() {
  return new TextEncoder().encode(env.ADMIN_SESSION_SECRET)
}
