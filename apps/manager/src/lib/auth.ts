// API route authentication.
// Supports two auth methods:
// 1. Strapi JWT cookie (set by /api/auth/login) — for dashboard UI
// 2. Bearer token header (MANAGER_API_KEY) — for external API clients
// In development with no MANAGER_API_KEY set, API key auth is skipped.

import { NextResponse } from "next/server"
import { env } from "@/config/env"

export function authenticateRequest(request: Request): NextResponse | null {
  // Check Bearer token first (for API clients)
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    const apiKey = env.MANAGER_API_KEY
    if (apiKey && token === apiKey) {
      return null // Authenticated via API key
    }
  }

  // Check Strapi JWT cookie (for dashboard UI)
  const cookieHeader = request.headers.get("cookie") ?? ""
  const jwtMatch = cookieHeader.match(/strapi-jwt=([^;]+)/)
  if (jwtMatch?.[1]) {
    return null // Authenticated via Strapi session
  }

  // In development with no API key, allow unauthenticated access
  if (!env.MANAGER_API_KEY) {
    return null
  }

  return NextResponse.json(
    { error: "Authentication required" },
    { status: 401 },
  )
}
