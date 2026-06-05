import { revalidatePath } from "next/cache"
import { requireAdminSession } from "@/auth/session"
import { NotFoundError } from "@/services/errors"
import {
  approveUserRole,
  grantManagerAccess as grantManagerAccessForUser,
  revokeManagerAccess as revokeManagerAccessForUser,
} from "@/services/user-access.service"

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

export async function grantManagerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  if (typeof id !== "string") return

  try {
    await grantManagerAccessForUser({ user, targetUserId: id })
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
  revalidatePath("/dashboard/users")
}

export async function revokeManagerAccess(formData: FormData) {
  "use server"

  const user = await requireAdminSession()
  const id = formData.get("id")
  if (typeof id !== "string") return

  try {
    await revokeManagerAccessForUser({ user, targetUserId: id })
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }
  }
  revalidatePath("/dashboard/users")
}
