import { NextResponse } from "next/server"
import { z } from "zod"

import { isValidManagerBearer } from "@/auth/manager-bearer"
import { isValidManagerServiceToken } from "@/auth/manager-service-token"
import { prisma } from "@/db/client"

const payloadSchema = z.object({
  subject: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
})

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization")
  const isAuthorized =
    (await isValidManagerServiceToken(authorization, request.url)) ||
    isValidManagerBearer(authorization)

  if (!isAuthorized) {
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
        ...(email ? { emailVerified: true } : {}),
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
