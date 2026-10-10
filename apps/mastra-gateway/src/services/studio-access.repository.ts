import type {
  StudioAccessRecord,
  StudioAccessRepository,
  StudioAccessRole,
  StudioAccessStatus,
} from "./studio-access.service"
import { prisma } from "@/db/client"

function toRecord(row: {
  id: string
  subject: string | null
  email: string
  name: string | null
  status: string
  role: string
}): StudioAccessRecord {
  return {
    id: row.id,
    subject: row.subject,
    email: row.email,
    name: row.name,
    status: row.status.toLowerCase() as StudioAccessStatus,
    role: row.role.toLowerCase() as StudioAccessRole,
  }
}

function toPrismaRole(role: StudioAccessRole) {
  return role.toUpperCase() as "ADMIN" | "EDITOR"
}

export const studioAccessRepository: StudioAccessRepository = {
  async findBySubjectOrEmail({ subject, email }) {
    const row = await prisma.studioAccess.findFirst({
      where: {
        OR: [{ subject }, ...(email ? [{ email }] : [])],
      },
    })
    return row ? toRecord(row) : null
  },

  async upsertBootstrapAdmin({ subject, email, name }) {
    const row = await prisma.studioAccess.upsert({
      where: { email },
      update: {
        subject,
        name,
        status: "APPROVED",
        role: "ADMIN",
        approvedAt: new Date(),
        revokedAt: null,
      },
      create: {
        subject,
        email,
        name,
        status: "APPROVED",
        role: "ADMIN",
        approvedAt: new Date(),
        approvedBy: "bootstrap",
      },
    })
    return toRecord(row)
  },

  async requestAccess({ subject, email, name }) {
    const row = await prisma.studioAccess.upsert({
      where: { email },
      update: {
        subject,
        name,
        status: "PENDING",
      },
      create: {
        subject,
        email,
        name,
        status: "PENDING",
        role: "EDITOR",
      },
    })
    return toRecord(row)
  },

  async listByEmails({ emails }) {
    if (emails.length === 0) return []

    const rows = await prisma.studioAccess.findMany({
      where: { email: { in: [...emails] } },
      orderBy: { email: "asc" },
    })
    return rows.map(toRecord)
  },

  async list() {
    const rows = await prisma.studioAccess.findMany({
      orderBy: [{ status: "asc" }, { email: "asc" }],
    })
    return rows.map(toRecord)
  },

  async approve({ id, role, approvedBy }) {
    const row = await prisma.studioAccess.update({
      where: { id },
      data: {
        status: "APPROVED",
        role: toPrismaRole(role),
        approvedBy,
        approvedAt: new Date(),
        revokedAt: null,
      },
    })
    return toRecord(row)
  },

  async approveByEmail({ email, name, role, approvedBy }) {
    const now = new Date()
    const nameData = name === undefined ? {} : { name }
    const row = await prisma.studioAccess.upsert({
      where: { email },
      update: {
        ...nameData,
        status: "APPROVED",
        role: toPrismaRole(role),
        approvedBy,
        approvedAt: now,
        revokedAt: null,
      },
      create: {
        email,
        ...nameData,
        status: "APPROVED",
        role: toPrismaRole(role),
        approvedBy,
        approvedAt: now,
      },
    })
    return toRecord(row)
  },

  async revoke({ id }) {
    const row = await prisma.studioAccess.update({
      where: { id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    })
    return toRecord(row)
  },

  async revokeByEmail({ email }) {
    const existing = await prisma.studioAccess.findUnique({
      where: { email },
      select: { id: true },
    })
    if (!existing) return null

    const row = await prisma.studioAccess.update({
      where: { email },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    })
    return toRecord(row)
  },

  async updateRole({ id, role }) {
    const row = await prisma.studioAccess.update({
      where: { id },
      data: { role: toPrismaRole(role) },
    })
    return toRecord(row)
  },

  async markAccessed({ id }) {
    await prisma.studioAccess.update({
      where: { id },
      data: { lastAccessAt: new Date() },
    })
  },
}
