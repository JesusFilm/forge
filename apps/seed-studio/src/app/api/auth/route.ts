import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const SESSION_COOKIE = "seed-studio-session"
const SESSION_MAX_AGE = 60 * 60 * 24 // 24 hours

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { password?: string }
  const password = body.password ?? ""
  const expected = process.env.SEED_STUDIO_PASSWORD ?? ""

  if (!expected || password !== expected) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 })
  }

  const token = crypto.randomUUID()
  const response = NextResponse.json({ ok: true })

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  })

  return response
}
