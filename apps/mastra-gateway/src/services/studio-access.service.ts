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
  requestAccess(input: {
    subject: string
    email: string
    name?: string
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
}: {
  repository: StudioAccessRepository
}) {
  async function resolve(
    identity: StudioAccessIdentity,
  ): Promise<StudioAccessDecision> {
    const email = normalizeEmail(identity.email)
    if (!email) return { allowed: false, reason: "missing_email" }

    const record = await repository.findBySubjectOrEmail({
      subject: identity.subject,
      email,
    })

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

  return {
    resolve,
  }
}
