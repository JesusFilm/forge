import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  ADMIN_OAUTH_ACCESS_REQUEST_COOKIE,
  adminOAuthAccessRequestCookieOptions,
  readAdminOAuthAccessRequestCookie,
} from "@/auth/auth-session"
import { prisma } from "@/db/client"

export async function POST(): Promise<Response> {
  const cookieStore = await cookies()
  const request = await readAdminOAuthAccessRequestCookie(
    cookieStore.get(ADMIN_OAUTH_ACCESS_REQUEST_COOKIE)?.value,
  )

  if (!request) {
    return Response.json(
      { error: "No access request available." },
      { status: 400 },
    )
  }

  const email = request.email ?? `${request.subject}@auth.local`
  const name = request.name ?? request.email ?? "Auth user"
  const existingByEmail = request.email
    ? await prisma.user.findUnique({
        where: { email: request.email },
        select: { id: true, role: true },
      })
    : null
  const existingBySubject = await prisma.user.findUnique({
    where: { id: request.subject },
    select: { id: true, role: true },
  })
  const existing = existingByEmail ?? existingBySubject

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        email,
        name,
        emailVerified: Boolean(request.email),
      },
      select: { id: true },
    })
  } else {
    await prisma.user.create({
      data: {
        id: request.subject,
        email,
        name,
        emailVerified: Boolean(request.email),
        role: "VIEWER",
      },
      select: { id: true },
    })
  }

  const response = NextResponse.json({ ok: true }, { status: 202 })
  response.cookies.delete({
    name: ADMIN_OAUTH_ACCESS_REQUEST_COOKIE,
    ...adminOAuthAccessRequestCookieOptions(),
  })
  return response
}
