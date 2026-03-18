// API route authentication.
// Supports two auth methods:
// 1. Strapi JWT cookie (set by /api/auth/login) — for dashboard UI
// 2. Bearer token header (MANAGER_API_KEY) — for external API clients
// Auth is enforced in all environments (dev included).

import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { env } from "@/config/env"

type StrapiUser = {
  id: number
  username: string
  email: string
  role?: {
    name: string
    type: string
  }
}

/**
 * Fetches a Strapi user by ID with role populated using the admin API token.
 * Private — callers must only pass IDs obtained from a verified source
 * (JWT-validated /api/users/me or /api/auth/local response).
 */
async function fetchUserWithRole(userId: number): Promise<StrapiUser | null> {
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
 * Verifies a Strapi JWT and returns the user with role populated.
 * First validates the JWT via /api/users/me to get the trusted user ID,
 * then fetches the role via admin API token (bypasses content API sanitization).
 */
export async function verifyStrapiJwtWithRole(
  jwt: string,
): Promise<StrapiUser | null> {
  try {
    // Verify JWT is valid and get user ID
    const meResponse = await fetch(`${env.STRAPI_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(5000),
    })

    if (!meResponse.ok) {
      return null
    }

    const me = (await meResponse.json()) as { id: number }

    // Fetch full user with role using admin API token
    return await fetchUserWithRole(me.id)
  } catch {
    return null
  }
}

export async function authenticateRequest(
  request: Request,
): Promise<NextResponse | null> {
  // Check Bearer token first (for API clients)
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    const apiKey = env.MANAGER_API_KEY
    if (apiKey) {
      const a = Buffer.from(token)
      const b = Buffer.from(apiKey)
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return null // Authenticated via API key
      }
    }
  }

  // Check Strapi JWT cookie (for dashboard UI)
  // Extract the token and validate it against Strapi to confirm it is
  // genuine, unexpired, and belongs to a user with the Manager role.
  const cookieHeader = request.headers.get("cookie") ?? ""
  const jwtMatch = cookieHeader.match(/strapi-jwt=([^;]+)/)
  if (jwtMatch?.[1]) {
    const user = await verifyStrapiJwtWithRole(jwtMatch[1])
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
