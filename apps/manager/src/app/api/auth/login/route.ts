import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { env } from "@/config/env"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
  })

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const { jwt } = (await res.json()) as { jwt: string; user: unknown }

  // Verify the user has the Manager role
  const meRes = await fetch(`${env.STRAPI_URL}/api/users/me?populate=role`, {
    headers: { Authorization: `Bearer ${jwt}` },
  })
  const me = (await meRes.json()) as {
    id: number
    email: string
    role?: { name: string }
  }

  if (me.role?.name !== "Manager") {
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
    user: { id: me.id, email: me.email, role: me.role?.name },
  })
}
