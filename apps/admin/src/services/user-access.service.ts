import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { prisma as defaultPrisma } from "@/db/client"
import { ForbiddenError, NotFoundError } from "@/services/errors"

export type AdminAssignableRole = "EDITOR" | "ADMIN"

type PrismaLike = Pick<PrismaClient, "user" | "managerMembership">

function assertAdmin(user: Principal | null) {
  if (!hasPermission(user, "admin:all")) {
    throw new ForbiddenError()
  }
}

async function assertTargetUserExists(
  prisma: PrismaLike,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    throw new NotFoundError("User", userId)
  }
}

export async function approveUserRole(
  {
    user,
    targetUserId,
    role,
  }: {
    user: Principal | null
    targetUserId: string
    role: AdminAssignableRole
  },
  prisma: PrismaLike = defaultPrisma,
) {
  assertAdmin(user)

  return prisma.user.update({
    where: { id: targetUserId },
    data: { role },
    select: { id: true },
  })
}

export async function grantManagerAccess(
  {
    user,
    targetUserId,
  }: {
    user: Principal | null
    targetUserId: string
  },
  prisma: PrismaLike = defaultPrisma,
) {
  assertAdmin(user)
  await assertTargetUserExists(prisma, targetUserId)

  return prisma.managerMembership.upsert({
    where: { userId: targetUserId },
    create: {
      userId: targetUserId,
      role: "OPERATOR",
    },
    update: {
      role: "OPERATOR",
      revokedAt: null,
    },
    select: { id: true },
  })
}

export async function revokeManagerAccess(
  {
    user,
    targetUserId,
  }: {
    user: Principal | null
    targetUserId: string
  },
  prisma: PrismaLike = defaultPrisma,
) {
  assertAdmin(user)
  await assertTargetUserExists(prisma, targetUserId)

  return prisma.managerMembership.updateMany({
    where: {
      userId: targetUserId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  })
}
