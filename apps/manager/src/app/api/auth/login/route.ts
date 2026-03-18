import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { env } from "@/config/env"
import { verifyStrapiJwtWithRole } from "@/lib/auth"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const authResponseSchema = z.object({
  jwt: z.string().min(1),
})

export async function POST(request: Request) {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = loginSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    )
  }

  const { email, password } = parsed.data

  // Authenticate against Strapi Users & Permissions
  const res = await fetch(`${env.STRAPI_URL}/api/auth/local`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
    signal: AbortSignal.timeout(5000),
  })

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const authParsed = authResponseSchema.safeParse(await res.json())
  if (!authParsed.success) {
    return NextResponse.json(
      { error: "Unexpected auth response from upstream" },
      { status: 502 },
    )
  }
  const { jwt } = authParsed.data

  // Verify JWT and fetch user with role (uses admin API token internally)
  const user = await verifyStrapiJwtWithRole(jwt)

  if (!user) {
    return NextResponse.json(
      { error: "Failed to fetch user profile from upstream" },
      { status: 502 },
    )
  }

  if (user.role?.name !== "Manager") {
    return NextResponse.json({ error: "Unauthorized role" }, { status: 403 })
  }

  const cookieStore = await cookies()
  cookieStore.set("strapi-jwt", jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })

  return NextResponse.json({
    user: { id: user.id, email: user.email, role: user.role?.name },
  })
}
