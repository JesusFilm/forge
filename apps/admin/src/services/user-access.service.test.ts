import { describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import {
  approveUserRole,
  grantManagerAccess,
  revokeManagerAccess,
} from "@/services/user-access.service"

const adminUser = {
  id: "admin-user-1",
  role: "ADMIN",
} as const satisfies Principal

const editorUser = {
  id: "editor-user-1",
  role: "EDITOR",
} as const satisfies Principal

function makeMockPrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    managerMembership: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
  } as const
}

describe("user-access.service", () => {
  it("approves an admin-local user role for Admin principals", async () => {
    const prisma = makeMockPrisma()
    prisma.user.update.mockResolvedValueOnce({ id: "target-user-1" })

    await approveUserRole(
      {
        user: adminUser,
        targetUserId: "target-user-1",
        role: "EDITOR",
      },
      prisma as never,
    )

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "target-user-1" },
      data: { role: "EDITOR" },
      select: { id: true },
    })
  })

  it("rejects role approvals for non-Admin principals", async () => {
    const prisma = makeMockPrisma()

    await expect(
      approveUserRole(
        {
          user: editorUser,
          targetUserId: "target-user-1",
          role: "ADMIN",
        },
        prisma as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("grants Manager operator access by upserting an active membership", async () => {
    const prisma = makeMockPrisma()
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.upsert.mockResolvedValueOnce({
      id: "membership-1",
    })

    await grantManagerAccess(
      {
        user: adminUser,
        targetUserId: "target-user-1",
      },
      prisma as never,
    )

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "target-user-1" },
      select: { id: true },
    })
    expect(prisma.managerMembership.upsert).toHaveBeenCalledWith({
      where: { userId: "target-user-1" },
      create: {
        userId: "target-user-1",
        role: "OPERATOR",
      },
      update: {
        role: "OPERATOR",
        revokedAt: null,
      },
      select: { id: true },
    })
  })

  it("rejects Manager grants for non-Admin principals before reading users", async () => {
    const prisma = makeMockPrisma()

    await expect(
      grantManagerAccess(
        {
          user: editorUser,
          targetUserId: "target-user-1",
        },
        prisma as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("throws NotFoundError instead of writing when the Manager grant target user is missing", async () => {
    const prisma = makeMockPrisma()
    prisma.user.findUnique.mockResolvedValueOnce(null)

    await expect(
      grantManagerAccess(
        {
          user: adminUser,
          targetUserId: "missing-user",
        },
        prisma as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(prisma.managerMembership.upsert).not.toHaveBeenCalled()
  })

  it("revokes only an active Manager membership", async () => {
    const prisma = makeMockPrisma()
    prisma.user.findUnique.mockResolvedValueOnce({ id: "target-user-1" })
    prisma.managerMembership.updateMany.mockResolvedValueOnce({ count: 1 })

    await revokeManagerAccess(
      {
        user: adminUser,
        targetUserId: "target-user-1",
      },
      prisma as never,
    )

    expect(prisma.managerMembership.updateMany).toHaveBeenCalledTimes(1)
    const arg = prisma.managerMembership.updateMany.mock.calls[0]![0]!
    expect(arg.where).toEqual({
      userId: "target-user-1",
      revokedAt: null,
    })
    expect(arg.data.revokedAt).toBeInstanceOf(Date)
  })

  it("rejects Manager revokes for non-Admin principals before reading users", async () => {
    const prisma = makeMockPrisma()

    await expect(
      revokeManagerAccess(
        {
          user: editorUser,
          targetUserId: "target-user-1",
        },
        prisma as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.managerMembership.updateMany).not.toHaveBeenCalled()
  })
})
