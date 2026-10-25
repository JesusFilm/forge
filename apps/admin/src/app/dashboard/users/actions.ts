import { revalidatePath } from "next/cache"
import { requireAdminSession } from "@/auth/session"
import { NotFoundError } from "@/services/errors"
import {
  approveUserRole,
  grantManagerAccess as grantManagerAccessForUser,
  grantReviewerLanguageAccess,
  revokeManagerAccess as revokeManagerAccessForUser,
  revokeReviewerLanguageAccess,
  type ReviewerRubricDimension,
} from "@/services/user-access.service"
import { updateMastraStudioAccessByEmail } from "@/services/mastra-studio-access.service"

export async function approveUser(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  const role = formData.get("role")

  if (typeof id !== "string" || (role !== "EDITOR" && role !== "ADMIN")) {
    return
  }

  await approveUserRole({ user, targetUserId: id, role })
  revalidatePath("/dashboard/users")
}

export async function updateManagerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  const role = formData.get("role")
  if (typeof id !== "string" || (role !== "OPERATOR" && role !== "NO_ACCESS")) {
    return
  }

  try {
    if (role === "OPERATOR") {
      await grantManagerAccessForUser({ user, targetUserId: id })
    } else {
      await revokeManagerAccessForUser({ user, targetUserId: id })
    }
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
  revalidatePath("/dashboard/users")
}

export async function updateMastraStudioAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const email = formData.get("email")
  const role = formData.get("role")
  if (
    typeof email !== "string" ||
    (role !== "STUDIO_ACCESS" && role !== "NO_ACCESS")
  ) {
    return
  }

  await updateMastraStudioAccessByEmail({
    email,
    role,
    approvedBy: user.id ?? "admin",
  })
  revalidatePath("/dashboard/users")
}

const REVIEWER_RUBRIC_DIMENSIONS = [
  "MEANING_ACCURACY",
  "NATURALNESS",
  "TIMING_READABILITY",
  "SCRIPTURE_THEOLOGY",
] as const satisfies readonly ReviewerRubricDimension[]

function trimmedField(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

/**
 * A reviewer grant is language-scoped and carries its own recorded
 * justification, so it cannot be expressed as the role dropdown the other
 * product grants use. The service owns authorization and the real validation;
 * this boundary only rejects input the form should never have produced and
 * drops rubric dimensions outside the known set.
 */
export async function grantReviewerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const targetUserId = trimmedField(formData, "id")
  const languageId = trimmedField(formData, "languageId")
  const targetProficiencyEvidence = trimmedField(
    formData,
    "targetProficiencyEvidence",
  )
  const sourceProficiencyEvidence = trimmedField(
    formData,
    "sourceProficiencyEvidence",
  )
  const reason = trimmedField(formData, "reason")
  const permittedRubricDimensions = formData
    .getAll("dimension")
    .filter(
      (value): value is ReviewerRubricDimension =>
        typeof value === "string" &&
        (REVIEWER_RUBRIC_DIMENSIONS as readonly string[]).includes(value),
    )

  if (
    !targetUserId ||
    !languageId ||
    !targetProficiencyEvidence ||
    !reason ||
    permittedRubricDimensions.length === 0
  ) {
    return
  }

  await grantReviewerLanguageAccess({
    user,
    targetUserId,
    languageId,
    targetProficiencyEvidence,
    // Optional on the service; send undefined rather than a blank string so
    // its bounded-text validation is not tripped by an untouched field.
    sourceProficiencyEvidence: sourceProficiencyEvidence || undefined,
    permittedRubricDimensions,
    scriptureSpecialist: formData.get("scriptureSpecialist") === "on",
    theologySpecialist: formData.get("theologySpecialist") === "on",
    reason,
  })
  revalidatePath("/dashboard/users")
}

export async function revokeReviewerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const targetUserId = trimmedField(formData, "id")
  const languageId = trimmedField(formData, "languageId")
  const reason = trimmedField(formData, "reason")

  if (!targetUserId || !languageId || !reason) {
    return
  }

  try {
    await revokeReviewerLanguageAccess({
      user,
      targetUserId,
      languageId,
      reason,
    })
  } catch (error) {
    // Same posture as updateManagerAccess: a grant that is already gone is not
    // an operator-facing failure.
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
  revalidatePath("/dashboard/users")
}
