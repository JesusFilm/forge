import { jwtVerify, SignJWT } from "jose"

import { env } from "@/config/env"
import type { StudioAccessRole } from "@/services/studio-access.service"

export const GATEWAY_SESSION_COOKIE = "mastra-gateway-session"
export const GATEWAY_OAUTH_STATE_COOKIE = "mastra-gateway-oauth-state"
export const GATEWAY_OAUTH_VERIFIER_COOKIE = "mastra-gateway-oauth-verifier"
export const GATEWAY_OAUTH_RETURN_TO_COOKIE = "mastra-gateway-oauth-return-to"

const maxAgeSeconds = 60 * 60 * 12

export type GatewaySession = {
  subject: string
  email?: string
  name?: string
  role: StudioAccessRole
}

export async function createGatewaySessionCookie(session: GatewaySession) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSigningKey())
}

export async function readGatewaySessionCookie(
  value?: string,
): Promise<GatewaySession | null> {
  if (!value) return null

  try {
    const { payload } = await jwtVerify(value, getSigningKey(), {
      algorithms: ["HS256"],
    })

    if (
      typeof payload.subject !== "string" ||
      !isGatewayRole(payload.role) ||
      ("email" in payload && typeof payload.email !== "string") ||
      ("name" in payload && typeof payload.name !== "string")
    ) {
      return null
    }

    return {
      subject: payload.subject,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      role: payload.role,
    }
  } catch {
    return null
  }
}

export function gatewaySessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

export function expiredGatewaySessionCookieOptions() {
  return {
    ...gatewaySessionCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  }
}

function isGatewayRole(role: unknown): role is StudioAccessRole {
  return role === "admin" || role === "editor"
}

function getSigningKey() {
  if (!env.MASTRA_GATEWAY_SESSION_SECRET) {
    throw new Error("MASTRA_GATEWAY_SESSION_SECRET is required")
  }
  return new TextEncoder().encode(env.MASTRA_GATEWAY_SESSION_SECRET)
}
