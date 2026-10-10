"use server"

import { revalidatePath } from "next/cache"

import { requireGatewaySession } from "@/lib/require-session"
import { createGatewayStudioAccessService } from "@/services/studio-access.factory"
import type { StudioAccessRole } from "@/services/studio-access.service"

export async function approveAccess(formData: FormData) {
  const session = await requireGatewaySession({ admin: true })
  const id = requireString(formData.get("id"), "id")
  const role = parseRole(formData.get("role"))

  await createGatewayStudioAccessService().approve({
    id,
    role,
    approvedBy: session.email ?? session.subject,
  })
  revalidatePath("/admin")
}

export async function updateAccessRole(formData: FormData) {
  await requireGatewaySession({ admin: true })
  const id = requireString(formData.get("id"), "id")
  const role = parseRole(formData.get("role"))

  await createGatewayStudioAccessService().updateRole({ id, role })
  revalidatePath("/admin")
}

export async function revokeAccess(formData: FormData) {
  await requireGatewaySession({ admin: true })
  const id = requireString(formData.get("id"), "id")

  await createGatewayStudioAccessService().revoke({ id })
  revalidatePath("/admin")
}

function requireString(value: FormDataEntryValue | null, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

function parseRole(value: FormDataEntryValue | null): StudioAccessRole {
  if (value === "admin" || value === "editor") return value
  throw new Error("role must be admin or editor")
}
