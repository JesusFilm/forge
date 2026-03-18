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
 * Validates a Strapi JWT by calling /api/users/me and confirms the user
 * holds the "Manager" role. Returns the user on success, null on failure.
 */
async function validateStrapiJwt(jwt: string): Promise<StrapiUser | null> {
  try {
    const response = await fetch(
      `${env.STRAPI_URL}/api/users/me?populate=role`,
      {
        headers: { Authorization: `Bearer ${jwt}` },
        // Short timeout to avoid blocking API routes if Strapi is slow
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      return null
    }

    const user = (await response.json()) as StrapiUser

    // Confirm user has the Manager role
    if (!user.role || user.role.name !== "Manager") {
      return null
    }

    return user
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
    const user = await validateStrapiJwt(jwtMatch[1])
    if (user) {
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
