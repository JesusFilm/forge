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

export const studioAccessRepository: StudioAccessRepository = {
  async findBySubjectOrEmail({ subject, email }) {
    const row = await prisma.studioAccess.findFirst({
      where: {
        OR: [{ subject }, ...(email ? [{ email }] : [])],
      },
    })
    return row ? toRecord(row) : null
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

  async markAccessed({ id }) {
    await prisma.studioAccess.update({
      where: { id },
      data: { lastAccessAt: new Date() },
    })
  },
}
