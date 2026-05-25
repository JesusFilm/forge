"use server"

import { revalidatePath } from "next/cache"

import {
  approveInternalAccessGrant,
  canManageInternalAccess,
  revokeInternalAccessGrant,
} from "@/data/access-grants"
import { requireDeveloperSession } from "@/lib/session"

export async function approveAccessGrant(formData: FormData) {
  const session = await requireDeveloperAdminSession()

  await approveInternalAccessGrant({
    actorUserId: session.subject,
    environmentId: requireFormValue(formData, "environmentId"),
    reason: optionalFormValue(formData, "reason"),
    scopes: formData.getAll("scopes").map(String),
    userId: requireFormValue(formData, "userId"),
  })

  revalidatePath("/access")
}

export async function revokeAccessGrant(formData: FormData) {
  const session = await requireDeveloperAdminSession()

  await revokeInternalAccessGrant({
    actorUserId: session.subject,
    grantId: requireFormValue(formData, "grantId"),
    reason: optionalFormValue(formData, "reason") || "Revoked in Developer",
  })

  revalidatePath("/access")
}

async function requireDeveloperAdminSession() {
  const session = await requireDeveloperSession("/access")
  if (!(await canManageInternalAccess(session.subject))) {
    throw new Error("Developer admin access is required.")
  }
  return session
}

function requireFormValue(formData: FormData, name: string) {
  const value = formData.get(name)
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function optionalFormValue(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}
