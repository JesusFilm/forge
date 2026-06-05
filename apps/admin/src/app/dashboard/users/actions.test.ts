import { beforeEach, describe, expect, it, vi } from "vitest"
import { NotFoundError } from "@/services/errors"

const requireAdminSession = vi.fn()
const revalidatePath = vi.fn()
const approveUserRole = vi.fn()
const grantManagerAccessForUser = vi.fn()
const revokeManagerAccessForUser = vi.fn()

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))

vi.mock("@/auth/session", () => ({
  requireAdminSession: (...args: unknown[]) => requireAdminSession(...args),
}))

vi.mock("@/services/user-access.service", () => ({
  approveUserRole: (...args: unknown[]) => approveUserRole(...args),
  grantManagerAccess: (...args: unknown[]) =>
    grantManagerAccessForUser(...args),
  revokeManagerAccess: (...args: unknown[]) =>
    revokeManagerAccessForUser(...args),
}))

import {
  approveUser,
  grantManagerAccess,
  revokeManagerAccess,
} from "@/app/dashboard/users/actions"

const adminUser = { id: "admin-user-1", role: "ADMIN" }

function form(values: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value)
  }
  return formData
}

describe("dashboard users server actions", () => {
  beforeEach(() => {
    requireAdminSession.mockReset()
    revalidatePath.mockReset()
    approveUserRole.mockReset()
    grantManagerAccessForUser.mockReset()
    revokeManagerAccessForUser.mockReset()
    requireAdminSession.mockResolvedValue(adminUser)
  })

  it("approves a valid Admin-local role and revalidates the users page", async () => {
    await approveUser(form({ id: "target-user-1", role: "EDITOR" }))

    expect(approveUserRole).toHaveBeenCalledWith({
      user: adminUser,
      targetUserId: "target-user-1",
      role: "EDITOR",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("ignores unsupported role approval form values", async () => {
    await approveUser(form({ id: "target-user-1", role: "VIEWER" }))

    expect(approveUserRole).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("grants Manager access for a valid row and revalidates", async () => {
    await grantManagerAccess(form({ id: "target-user-1" }))

    expect(grantManagerAccessForUser).toHaveBeenCalledWith({
      user: adminUser,
      targetUserId: "target-user-1",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("revokes Manager access for a valid row and revalidates", async () => {
    await revokeManagerAccess(form({ id: "target-user-1" }))

    expect(revokeManagerAccessForUser).toHaveBeenCalledWith({
      user: adminUser,
      targetUserId: "target-user-1",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("does not write or revalidate Manager access when id is missing", async () => {
    await grantManagerAccess(new FormData())
    await revokeManagerAccess(new FormData())

    expect(grantManagerAccessForUser).not.toHaveBeenCalled()
    expect(revokeManagerAccessForUser).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("swallows missing Manager grant targets and still revalidates", async () => {
    grantManagerAccessForUser.mockRejectedValueOnce(
      new NotFoundError("User", "missing-user"),
    )

    await grantManagerAccess(form({ id: "missing-user" }))

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("rethrows non-NotFound Manager revoke failures", async () => {
    revokeManagerAccessForUser.mockRejectedValueOnce(new Error("db failed"))

    await expect(
      revokeManagerAccess(form({ id: "target-user-1" })),
    ).rejects.toThrow("db failed")

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
