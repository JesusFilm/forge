import { jwtVerify, SignJWT } from "jose"

import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"

export const ADMIN_OAUTH_SESSION_COOKIE = "forge_admin_oauth_session"
export const ADMIN_OAUTH_STATE_COOKIE = "forge_admin_oauth_state"
export const ADMIN_OAUTH_VERIFIER_COOKIE = "forge_admin_oauth_verifier"
export const ADMIN_OAUTH_CALLBACK_COOKIE = "forge_admin_oauth_callback"

const maxAgeSeconds = 60 * 60 * 24 * 7

type AdminOAuthSessionPayload = Principal & {
  scopes: string[]
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
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSigningKey())
}

export async function readAdminOAuthSessionCookie(
  value?: string,
): Promise<Principal | null> {
  if (!value) return null

  const payload = await verifyPayload(value)
  if (!payload) {
    return null
  }

  return {
    id: payload.id,
    role: payload.role,
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
  return new TextEncoder().encode(env.BETTER_AUTH_SECRET ?? "development-only")
}
