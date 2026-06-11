import { beforeEach, describe, expect, it, vi } from "vitest"
import { NotFoundError } from "@/services/errors"

const requireAdminSession = vi.fn()
const revalidatePath = vi.fn()
const approveUserRole = vi.fn()
const grantManagerAccessForUser = vi.fn()
const revokeManagerAccessForUser = vi.fn()
const updateMastraStudioAccessByEmail = vi.fn()

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

vi.mock("@/services/mastra-studio-access.service", () => ({
  updateMastraStudioAccessByEmail: (...args: unknown[]) =>
    updateMastraStudioAccessByEmail(...args),
}))

import {
  approveUser,
  updateManagerAccess,
  updateMastraStudioAccess,
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
    updateMastraStudioAccessByEmail.mockReset()
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

  it("grants Manager access when the Operator role is selected", async () => {
    await updateManagerAccess(form({ id: "target-user-1", role: "OPERATOR" }))

    expect(grantManagerAccessForUser).toHaveBeenCalledWith({
      user: adminUser,
      targetUserId: "target-user-1",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("revokes Manager access when No access is selected", async () => {
    await updateManagerAccess(form({ id: "target-user-1", role: "NO_ACCESS" }))

    expect(revokeManagerAccessForUser).toHaveBeenCalledWith({
      user: adminUser,
      targetUserId: "target-user-1",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("does not write or revalidate Manager access for invalid form values", async () => {
    await updateManagerAccess(new FormData())
    await updateManagerAccess(form({ id: "target-user-1", role: "ADMIN" }))

    expect(grantManagerAccessForUser).not.toHaveBeenCalled()
    expect(revokeManagerAccessForUser).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("swallows missing Manager grant targets and still revalidates", async () => {
    grantManagerAccessForUser.mockRejectedValueOnce(
      new NotFoundError("User", "missing-user"),
    )

    await updateManagerAccess(form({ id: "missing-user", role: "OPERATOR" }))

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("rethrows non-NotFound Manager revoke failures", async () => {
    revokeManagerAccessForUser.mockRejectedValueOnce(new Error("db failed"))

    await expect(
      updateManagerAccess(form({ id: "target-user-1", role: "NO_ACCESS" })),
    ).rejects.toThrow("db failed")

    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("grants Mastra Studio access when Studio access is selected", async () => {
    await updateMastraStudioAccess(
      form({ email: "target@example.com", role: "STUDIO_ACCESS" }),
    )

    expect(updateMastraStudioAccessByEmail).toHaveBeenCalledWith({
      email: "target@example.com",
      role: "STUDIO_ACCESS",
      approvedBy: "admin-user-1",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("revokes Mastra Studio access when No access is selected", async () => {
    await updateMastraStudioAccess(
      form({ email: "target@example.com", role: "NO_ACCESS" }),
    )

    expect(updateMastraStudioAccessByEmail).toHaveBeenCalledWith({
      email: "target@example.com",
      role: "NO_ACCESS",
      approvedBy: "admin-user-1",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
  })

  it("does not write or revalidate Mastra Studio access for invalid form values", async () => {
    await updateMastraStudioAccess(new FormData())
    await updateMastraStudioAccess(
      form({ email: "target@example.com", role: "ADMIN" }),
    )

    expect(updateMastraStudioAccessByEmail).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("rethrows Mastra Studio update failures", async () => {
    updateMastraStudioAccessByEmail.mockRejectedValueOnce(
      new Error("gateway failed"),
    )

    await expect(
      updateMastraStudioAccess(
        form({ email: "target@example.com", role: "STUDIO_ACCESS" }),
      ),
    ).rejects.toThrow("gateway failed")

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
