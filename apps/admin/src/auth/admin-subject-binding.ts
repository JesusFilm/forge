// Durable Auth subject → Admin user binding (feat-712).
//
// The Admin OAuth callback can resolve an existing Admin user by verified
// email, so `User.id` is not always the Auth subject. Request-time surfaces
// that only hold an introspected subject (the Watch SEO capability) must not
// guess the user from email. Instead the callback records which Admin user a
// verified subject signed in as, and those surfaces resolve through that row.
//
// One subject maps to one user and one user to one subject (both columns are
// unique). A sign-in that would move either side is a conflict: it is
// rejected, never silently rebound. An operator resolves a real identity move
// by deleting the stale row.

import type { PrismaClient } from "@prisma/client"

import { isUniqueViolation } from "@/db/prisma-errors"

type BindingDb = Pick<PrismaClient, "adminAuthSubjectBinding">
type ResolveDb = Pick<PrismaClient, "adminAuthSubjectBinding" | "user">

export type AdminSubjectBindingConflict =
  | "subject_bound_to_other_user"
  | "user_bound_to_other_subject"

export type RecordAdminSubjectBindingResult =
  | { ok: true }
  | { ok: false; reason: AdminSubjectBindingConflict }

/**
 * Records (or refreshes) the binding for a subject that has just completed a
 * verified Admin OAuth sign-in as `userId`. Race-safe: concurrent first
 * sign-ins settle on the unique constraints, and the loser re-reads.
 */
export async function recordAdminSubjectBinding(
  db: BindingDb,
  input: { subject: string; userId: string; now?: Date },
): Promise<RecordAdminSubjectBindingResult> {
  const now = input.now ?? new Date()
  const existing = await db.adminAuthSubjectBinding.findUnique({
    where: { subject: input.subject },
    select: { userId: true },
  })
  if (existing) {
    if (existing.userId !== input.userId) {
      return { ok: false, reason: "subject_bound_to_other_user" }
    }
    await db.adminAuthSubjectBinding.update({
      where: { subject: input.subject },
      data: { lastVerifiedAt: now },
      select: { subject: true },
    })
    return { ok: true }
  }

  try {
    await db.adminAuthSubjectBinding.create({
      data: {
        subject: input.subject,
        userId: input.userId,
        lastVerifiedAt: now,
      },
      select: { subject: true },
    })
    return { ok: true }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }

  // Lost a race, or the user is already bound to a different subject.
  const settled = await db.adminAuthSubjectBinding.findUnique({
    where: { subject: input.subject },
    select: { userId: true },
  })
  if (settled?.userId === input.userId) return { ok: true }
  return {
    ok: false,
    reason: settled
      ? "subject_bound_to_other_user"
      : "user_bound_to_other_subject",
  }
}

export type AdminUserForSubject =
  | { ok: true; user: { id: string; role: string } }
  | { ok: false; reason: "user_not_found" | "subject_binding_conflict" }

/**
 * Resolves the Admin user for an introspected Auth subject. The recorded
 * binding is authoritative. Without one, a legacy user whose `User.id` IS
 * the subject still resolves, but only while that user has no binding of
 * its own: once a user is bound, no other subject can reach it by id.
 * There is no email fallback. The returned role is the live column value.
 */
export async function resolveAdminUserForSubject(
  db: ResolveDb,
  subject: string,
): Promise<AdminUserForSubject> {
  const binding = await db.adminAuthSubjectBinding.findUnique({
    where: { subject },
    select: { user: { select: { id: true, role: true } } },
  })
  if (binding) return { ok: true, user: binding.user }

  const legacy = await db.user.findUnique({
    where: { id: subject },
    select: {
      id: true,
      role: true,
      authSubjectBinding: { select: { subject: true } },
    },
  })
  if (!legacy) return { ok: false, reason: "user_not_found" }
  if (legacy.authSubjectBinding) {
    return { ok: false, reason: "subject_binding_conflict" }
  }
  return { ok: true, user: { id: legacy.id, role: legacy.role } }
}
