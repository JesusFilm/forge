import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"

import { env } from "@/config/env"
import { prisma } from "@/db/client"

const payloadSchema = z.object({
  subject: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  if (!isValidManagerBearer(request.headers.get("authorization"))) {
    return NextResponse.json(
      { error: "Manager service bearer token required" },
      { status: 403 },
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = payloadSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "subject is required and email must be valid when present" },
      { status: 400 },
    )
  }

  const user = await resolveManagerUser(parsed.data)
  if (!user?.managerMembership || user.managerMembership.revokedAt) {
    return NextResponse.json({ allowed: false })
  }

  return NextResponse.json({
    allowed: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    managerRole: user.managerMembership.role,
  })
}

function isValidManagerBearer(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ") || !env.MANAGER_ADMIN_API_KEY) {
    return false
  }

  const token = authHeader.slice("Bearer ".length)
  const a = Buffer.from(token)
  const b = Buffer.from(env.MANAGER_ADMIN_API_KEY)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function resolveManagerUser({
  subject,
  email,
  name,
}: z.infer<typeof payloadSchema>) {
  const select = {
    id: true,
    email: true,
    name: true,
    managerMembership: {
      select: {
        role: true,
        revokedAt: true,
      },
    },
  } as const

  const existingById = await prisma.user.findUnique({
    where: { id: subject },
    select,
  })

  if (existingById) {
    return prisma.user.update({
      where: { id: existingById.id },
      data: {
        email: email ?? existingById.email,
        name: name ?? existingById.name,
        emailVerified: Boolean(email),
      },
      select,
    })
  }

  if (!email) {
    return null
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select,
  })

  if (!existingByEmail) {
    return null
  }

  return prisma.user.update({
    where: { id: existingByEmail.id },
    data: {
      name: name ?? existingByEmail.name,
      emailVerified: true,
    },
    select,
  })
}
