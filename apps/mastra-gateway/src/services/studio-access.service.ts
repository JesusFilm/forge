export type StudioAccessRole = "admin" | "editor"
export type StudioAccessStatus = "pending" | "approved" | "revoked"

export type StudioAccessIdentity = {
  subject: string
  email?: string
  name?: string
}

export type StudioAccessRecord = {
  id: string
  subject: string | null
  email: string
  name: string | null
  status: StudioAccessStatus
  role: StudioAccessRole
}

export type StudioAccessRepository = {
  findBySubjectOrEmail(input: {
    subject: string
    email?: string
  }): Promise<StudioAccessRecord | null>
  upsertBootstrapAdmin(input: {
    subject: string
    email: string
    name?: string
  }): Promise<StudioAccessRecord>
  requestAccess(input: {
    subject: string
    email: string
    name?: string
  }): Promise<StudioAccessRecord>
  listByEmails(input: {
    emails: readonly string[]
  }): Promise<StudioAccessRecord[]>
  list(): Promise<StudioAccessRecord[]>
  approve(input: {
    id: string
    role: StudioAccessRole
    approvedBy: string
  }): Promise<StudioAccessRecord>
  approveByEmail(input: {
    email: string
    name?: string
    role: StudioAccessRole
    approvedBy: string
  }): Promise<StudioAccessRecord>
  revoke(input: { id: string }): Promise<StudioAccessRecord>
  revokeByEmail(input: { email: string }): Promise<StudioAccessRecord | null>
  updateRole(input: {
    id: string
    role: StudioAccessRole
  }): Promise<StudioAccessRecord>
  markAccessed(input: { id: string }): Promise<void>
}

export type StudioAccessDecision =
  | { allowed: true; role: StudioAccessRole; record: StudioAccessRecord }
  | { allowed: false; reason: "missing_email" | "pending" | "revoked" }

export function normalizeEmail(email?: string) {
  return email?.trim().toLowerCase()
}

export function createStudioAccessService({
  repository,
  bootstrapAdminEmails = [],
}: {
  repository: StudioAccessRepository
  bootstrapAdminEmails?: readonly string[]
}) {
  const bootstrapSet = new Set(
    bootstrapAdminEmails.map((email) => email.toLowerCase()),
  )

  async function resolve(
    identity: StudioAccessIdentity,
  ): Promise<StudioAccessDecision> {
    const email = normalizeEmail(identity.email)
    if (!email) return { allowed: false, reason: "missing_email" }

    let record = await repository.findBySubjectOrEmail({
      subject: identity.subject,
      email,
    })

    if (!record && bootstrapSet.has(email)) {
      record = await repository.upsertBootstrapAdmin({
        subject: identity.subject,
        email,
        name: identity.name,
      })
    }

    if (!record) {
      await repository.requestAccess({
        subject: identity.subject,
        email,
        name: identity.name,
      })
      return { allowed: false, reason: "pending" }
    }

    if (record.status === "revoked") {
      return { allowed: false, reason: "revoked" }
    }

    if (record.status !== "approved") {
      return { allowed: false, reason: "pending" }
    }

    await repository.markAccessed({ id: record.id })
    return { allowed: true, role: record.role, record }
  }

  async function requireAdmin(identity: StudioAccessIdentity) {
    const decision = await resolve(identity)
    return decision.allowed && decision.role === "admin"
  }

  function normalizeEmailOrThrow(email: string) {
    const normalized = normalizeEmail(email)
    if (!normalized) {
      throw new Error("email is required")
    }
    return normalized
  }

  async function listByEmails(emails: readonly string[]) {
    const normalizedEmails = Array.from(
      new Set(
        emails
          .map(normalizeEmail)
          .filter((email): email is string => Boolean(email)),
      ),
    )
    if (normalizedEmails.length === 0) return []
    return repository.listByEmails({ emails: normalizedEmails })
  }

  async function approveByEmail(input: {
    email: string
    name?: string
    role: StudioAccessRole
    approvedBy: string
  }) {
    return repository.approveByEmail({
      ...input,
      email: normalizeEmailOrThrow(input.email),
    })
  }

  async function revokeByEmail(input: { email: string }) {
    return repository.revokeByEmail({
      email: normalizeEmailOrThrow(input.email),
    })
  }

  return {
    resolve,
    requireAdmin,
    listByEmails,
    list: repository.list,
    approve: repository.approve,
    approveByEmail,
    revoke: repository.revoke,
    revokeByEmail,
    updateRole: repository.updateRole,
  }
}
