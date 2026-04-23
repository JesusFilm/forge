// API route authentication.
// Supports two auth methods:
// 1. Strapi JWT cookie (set by /api/auth/login) — for dashboard UI
// 2. Bearer token header (MANAGER_API_KEY) — for external API clients
// Auth is enforced in all environments (dev included).

import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import {
  getCmsGateway,
  registerLiveCmsGatewayAuthHandlers,
  type ManagerSession,
  type ManagerUser,
} from "@/cms/gateway"
import { env } from "@/config/env"

type StrapiUser = ManagerUser

export type ManagerOverrideActor =
  | {
      kind: "session"
      user: StrapiUser
      approvedByUserId: string
    }
  | {
      kind: "api_key"
      approvedByUserId: string
    }

function isValidManagerApiKey(token: string): boolean {
  const apiKey = env.MANAGER_API_KEY
  if (!apiKey) {
    return false
  }

  const a = Buffer.from(token)
  const b = Buffer.from(apiKey)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Fetches a Strapi user by ID with role populated using the admin API token.
 * Private — callers must only pass IDs obtained from a verified source
 * (JWT-validated /api/users/me or /api/auth/local response).
 */
export async function fetchUserWithRole(
  userId: number,
): Promise<StrapiUser | null> {
  try {
    const response = await fetch(
      `${env.STRAPI_URL}/api/users/${userId}?populate=role`,
      {
        headers: { Authorization: `Bearer ${env.STRAPI_API_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      return null
    }

    return (await response.json()) as StrapiUser
  } catch {
    return null
  }
}

/**
 * Verifies a Strapi JWT signature by calling /api/users/me.
 * Strapi returns 401 for invalid/expired JWTs, 200 or 403 for valid ones.
 * A 403 means the JWT is genuine but the role lacks the "me" permission —
 * in that case we decode the trusted user ID from the validated JWT.
 * Returns the user with role populated via admin API token.
 */
export async function verifyStrapiJwtWithRole(
  jwt: string,
): Promise<StrapiUser | null> {
  try {
    const meResponse = await fetch(`${env.STRAPI_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(5000),
    })

    if (meResponse.status === 401) {
      return null // JWT invalid or expired
    }

    let userId: number | undefined

    if (meResponse.ok) {
      // 200 — JWT valid and role has "me" permission
      const me = (await meResponse.json()) as { id: number }
      userId = me.id
    } else if (meResponse.status === 403) {
      // 403 — JWT signature is valid (Strapi verified it) but role lacks
      // the "me" permission. Decode the user ID from the verified JWT.
      const parts = jwt.split(".")
      if (parts.length !== 3) return null
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString(),
      ) as { id?: number }
      userId = payload.id
    }

    if (!userId) return null
    return await fetchUserWithRole(userId)
  } catch {
    return null
  }
}

async function loginManagerUserWithStrapi(
  email: string,
  password: string,
): Promise<ManagerSession | null> {
  const res = await fetch(`${env.STRAPI_URL}/api/auth/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    return null
  }

  const authResponseSchema = {
    safeParse(
      data: unknown,
    ):
      | { success: true; data: { jwt: string; user: { id: number } } }
      | { success: false } {
      if (
        typeof data === "object" &&
        data !== null &&
        typeof (data as { jwt?: unknown }).jwt === "string" &&
        typeof (data as { user?: { id?: unknown } }).user?.id === "number"
      ) {
        return {
          success: true,
          data: data as { jwt: string; user: { id: number } },
        }
      }

      return { success: false }
    },
  }

  const authParsed = authResponseSchema.safeParse(await res.json())
  if (!authParsed.success) {
    return null
  }

  const user = await fetchUserWithRole(authParsed.data.user.id)
  if (!user || user.role.name !== "Manager") {
    return null
  }

  return {
    token: authParsed.data.jwt,
    user,
  }
}

registerLiveCmsGatewayAuthHandlers({
  loginManagerUser: loginManagerUserWithStrapi,
  verifyManagerSession: verifyStrapiJwtWithRole,
})

export async function verifyManagerSession(
  token: string,
): Promise<StrapiUser | null> {
  return getCmsGateway().verifyManagerSession(token)
}

export async function authenticateRequest(
  request: Request,
): Promise<NextResponse | null> {
  // Check Bearer token first (for API clients)
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (isValidManagerApiKey(token)) {
      return null // Authenticated via API key
    }
  }

  // Check Strapi JWT cookie (for dashboard UI)
  // Verify the JWT signature via Strapi's /api/users/me, then check the role.
  const cookieHeader = request.headers.get("cookie") ?? ""
  const jwtMatch = cookieHeader.match(/strapi-jwt=([^;]+)/)
  if (jwtMatch?.[1]) {
    const user = await verifyManagerSession(jwtMatch[1])
    if (user?.role?.name === "Manager") {
      return null // Authenticated via validated Strapi session
    }
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    )
  }

  return NextResponse.json(
    { error: "Authentication required" },
    { status: 401 },
  )
}

export function authenticateServiceBearerRequest(
  request: Request,
): NextResponse | null {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (isValidManagerApiKey(token)) {
      return null
    }
  }

  return NextResponse.json(
    { error: "Service bearer token required" },
    { status: 403 },
  )
}

export async function authenticateManagerOverrideRequest(
  request: Request,
): Promise<ManagerOverrideActor | NextResponse> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (isValidManagerApiKey(token)) {
      return {
        kind: "api_key",
        approvedByUserId: "service:manager-api-key",
      }
    }

    return NextResponse.json(
      { error: "Interactive Manager session or API key required" },
      { status: 403 },
    )
  }

  // Check Strapi JWT cookie (for dashboard UI)
  // Verify the JWT signature via Strapi's /api/users/me, then check the role.
  const cookieHeader = request.headers.get("cookie") ?? ""
  const jwtMatch = cookieHeader.match(/strapi-jwt=([^;]+)/)
  if (!jwtMatch?.[1]) {
    return NextResponse.json(
      { error: "Interactive Manager session or API key required" },
      { status: 403 },
    )
  }

  const user = await verifyManagerSession(jwtMatch[1])
  if (user?.role?.name === "Manager") {
    return {
      kind: "session",
      user,
      approvedByUserId: String(user.id),
    }
  }

  return NextResponse.json(
    { error: "Interactive Manager session or API key required" },
    { status: 403 },
  )
}
