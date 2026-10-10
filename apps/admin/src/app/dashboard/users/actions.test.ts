import { beforeEach, describe, expect, it, vi } from "vitest"
import { NotFoundError } from "@/services/errors"

const requireAdminSession = vi.fn()
const revalidatePath = vi.fn()
const approveUserRole = vi.fn()
const grantManagerAccessForUser = vi.fn()
const revokeManagerAccessForUser = vi.fn()
const updateMastraStudioAccessByEmail = vi.fn()
const grantReviewerLanguageAccessForUser = vi.fn()
const revokeReviewerLanguageAccessForUser = vi.fn()

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
  grantReviewerLanguageAccess: (...args: unknown[]) =>
    grantReviewerLanguageAccessForUser(...args),
  revokeReviewerLanguageAccess: (...args: unknown[]) =>
    revokeReviewerLanguageAccessForUser(...args),
}))

vi.mock("@/services/mastra-studio-access.service", () => ({
  updateMastraStudioAccessByEmail: (...args: unknown[]) =>
    updateMastraStudioAccessByEmail(...args),
}))

import {
  approveUser,
  grantReviewerAccess,
  revokeReviewerAccess,
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
    grantReviewerLanguageAccessForUser.mockReset()
    revokeReviewerLanguageAccessForUser.mockReset()
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

  describe("reviewer language grants", () => {
    const validGrant = {
      id: "target-user-1",
      languageId: "language-es",
      targetProficiencyEvidence: "Native speaker, 6 years subtitling",
      sourceProficiencyEvidence: "C1 English certificate",
      reason: "Subtitle Lab pilot cohort",
      dimension: "MEANING_ACCURACY",
    }

    it("grants a reviewer language with every field the service requires", async () => {
      await grantReviewerAccess(form(validGrant))

      expect(grantReviewerLanguageAccessForUser).toHaveBeenCalledWith({
        user: adminUser,
        targetUserId: "target-user-1",
        languageId: "language-es",
        targetProficiencyEvidence: "Native speaker, 6 years subtitling",
        sourceProficiencyEvidence: "C1 English certificate",
        permittedRubricDimensions: ["MEANING_ACCURACY"],
        scriptureSpecialist: false,
        theologySpecialist: false,
        reason: "Subtitle Lab pilot cohort",
      })
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
    })

    it("collects every selected rubric dimension, not just the first", async () => {
      const formData = form(validGrant)
      formData.append("dimension", "NATURALNESS")
      formData.append("dimension", "TIMING_READABILITY")

      await grantReviewerAccess(formData)

      expect(
        grantReviewerLanguageAccessForUser.mock.calls[0][0]
          .permittedRubricDimensions,
      ).toEqual(["MEANING_ACCURACY", "NATURALNESS", "TIMING_READABILITY"])
    })

    it("passes the specialist flags through when checked", async () => {
      await grantReviewerAccess(
        form({
          ...validGrant,
          dimension: "SCRIPTURE_THEOLOGY",
          scriptureSpecialist: "on",
          theologySpecialist: "on",
        }),
      )

      const call = grantReviewerLanguageAccessForUser.mock.calls[0][0]
      expect(call.scriptureSpecialist).toBe(true)
      expect(call.theologySpecialist).toBe(true)
    })

    it("omits an empty optional source evidence rather than sending a blank string", async () => {
      await grantReviewerAccess(
        form({ ...validGrant, sourceProficiencyEvidence: "   " }),
      )

      expect(
        grantReviewerLanguageAccessForUser.mock.calls[0][0]
          .sourceProficiencyEvidence,
      ).toBeUndefined()
    })

    // The service throws on an unknown dimension. Dropping unknown values at the
    // boundary keeps a tampered form from reaching it, and keeps a valid
    // selection alongside a junk one working.
    it("drops an unrecognized rubric dimension", async () => {
      const formData = form(validGrant)
      formData.append("dimension", "NOT_A_DIMENSION")

      await grantReviewerAccess(formData)

      expect(
        grantReviewerLanguageAccessForUser.mock.calls[0][0]
          .permittedRubricDimensions,
      ).toEqual(["MEANING_ACCURACY"])
    })

    it.each([
      ["missing user id", { id: "" }],
      ["missing language", { languageId: "" }],
      ["missing target evidence", { targetProficiencyEvidence: "  " }],
      ["missing reason", { reason: "" }],
      ["no rubric dimension selected", { dimension: "" }],
    ])("refuses to grant with %s", async (_label, override) => {
      await grantReviewerAccess(form({ ...validGrant, ...override }))

      expect(grantReviewerLanguageAccessForUser).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it("revokes a reviewer language grant", async () => {
      await revokeReviewerAccess(
        form({
          id: "target-user-1",
          languageId: "language-es",
          reason: "Left the pilot",
        }),
      )

      expect(revokeReviewerLanguageAccessForUser).toHaveBeenCalledWith({
        user: adminUser,
        targetUserId: "target-user-1",
        languageId: "language-es",
        reason: "Left the pilot",
      })
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
    })

    it("refuses to revoke without a reason", async () => {
      await revokeReviewerAccess(
        form({ id: "target-user-1", languageId: "language-es", reason: " " }),
      )

      expect(revokeReviewerLanguageAccessForUser).not.toHaveBeenCalled()
    })

    // Revoking a grant the user does not hold is the service's NotFoundError
    // path; the page should re-render rather than surface a crash.
    it("swallows NotFoundError on revoke and still revalidates", async () => {
      revokeReviewerLanguageAccessForUser.mockRejectedValueOnce(
        new NotFoundError("Language", "language-es"),
      )

      await expect(
        revokeReviewerAccess(
          form({
            id: "target-user-1",
            languageId: "language-es",
            reason: "Left the pilot",
          }),
        ),
      ).resolves.toBeUndefined()
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/users")
    })

    it("does not swallow an unexpected grant failure", async () => {
      grantReviewerLanguageAccessForUser.mockRejectedValueOnce(
        new Error("permittedRubricDimensions must be non-empty and unique"),
      )

      await expect(grantReviewerAccess(form(validGrant))).rejects.toThrow(
        "permittedRubricDimensions",
      )
    })
  })
})
