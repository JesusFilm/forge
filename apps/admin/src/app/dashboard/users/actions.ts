import { revalidatePath } from "next/cache"
import { requireAdminSession } from "@/auth/session"
import { NotFoundError } from "@/services/errors"
import {
  approveUserRole,
  grantManagerAccess as grantManagerAccessForUser,
  revokeManagerAccess as revokeManagerAccessForUser,
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
