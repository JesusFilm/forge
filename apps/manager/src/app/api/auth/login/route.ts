import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getCmsGateway } from "@/cms/gateway"
import { hasManagerAccess } from "@/lib/auth"
import { MANAGER_SESSION_COOKIE } from "@/lib/session-cookie"

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
  const session = await getCmsGateway().loginManagerUser(email, password)
  if (!session || !hasManagerAccess(session.user)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const cookieStore = await cookies()
  cookieStore.set(MANAGER_SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  })

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role.name,
    },
  })
}
