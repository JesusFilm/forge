// Experience service — CRUD + list + getBySlug.
//
// Every method: (1) Zod parse input, (2) ABAC check, (3) Prisma call.
// Resolvers delegate here; they never call Prisma directly for mutations.

import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  hasPermission,
  canEditExperienceLocale,
  canPublishExperienceLocale,
  canArchiveExperience,
} from "@/auth/permissions"
import {
  CreateExperienceInput,
  UpdateExperienceLocaleInput,
  PublishExperienceLocaleInput,
  ArchiveExperienceInput,
} from "./experience.schemas"

class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message)
    this.name = "ForbiddenError"
  }
}

export class ExperienceService {
  constructor(private prisma: PrismaClient) {}

  async create({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = CreateExperienceInput.parse(raw)
    if (!hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }

    return this.prisma.experience.create({
      data: {
        isTemplate: input.isTemplate,
        ownerId: user?.id ?? null,
        locales: {
          create: {
            locale: input.locale,
            slug: input.slug,
            title: input.title,
            blocks: input.blocks,
          },
        },
      },
      include: { locales: true },
    })
  }

  async list({
    input: raw,
    user,
    query,
  }: {
    input: { limit?: number; offset?: number; includeArchived?: boolean }
    user: Principal | null
    query: object
  }) {
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }

    const role = user?.role ?? "PUBLIC"
    const includeArchived =
      raw.includeArchived && (role === "ADMIN" || role === "EDITOR")

    return this.prisma.experience.findMany({
      ...query,
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: Math.min(raw.limit ?? 50, 200),
      skip: raw.offset ?? 0,
    })
  }

  async getById({
    id,
    user,
    query,
  }: {
    id: string
    user: Principal | null
    query: object
  }) {
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }

    const role = user?.role ?? "PUBLIC"
    const where: Record<string, unknown> = { id }
    if (role !== "ADMIN" && role !== "EDITOR") {
      where.archivedAt = null
    }

    return this.prisma.experience.findFirst({ ...query, where })
  }

  async getBySlug({
    locale,
    slug,
    user,
    query,
  }: {
    locale: string
    slug: string
    user: Principal | null
    query: object
  }) {
    const role = user?.role ?? "PUBLIC"
    const where: Record<string, unknown> = { locale, slug }

    // PUBLIC and VIEWER see published only; EDITOR and ADMIN see all
    if (role !== "ADMIN" && role !== "EDITOR") {
      where.status = "PUBLISHED"
    }

    return this.prisma.experienceLocale.findFirst({ ...query, where })
  }

  async updateLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = UpdateExperienceLocaleInput.parse(raw)

    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: input.id },
      include: { experience: { select: { ownerId: true, archivedAt: true } } },
    })

    if (!canEditExperienceLocale(user, existing)) {
      throw new ForbiddenError()
    }

    const { id, ...data } = input
    return this.prisma.experienceLocale.update({
      where: { id },
      data,
    })
  }

  async publishLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = PublishExperienceLocaleInput.parse(raw)

    const existing = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: input.id },
      include: { experience: { select: { ownerId: true, archivedAt: true } } },
    })

    if (!canPublishExperienceLocale(user, existing)) {
      throw new ForbiddenError()
    }

    return this.prisma.experienceLocale.update({
      where: { id: input.id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    })
  }

  async archive({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = ArchiveExperienceInput.parse(raw)

    const existing = await this.prisma.experience.findFirst({
      where: { id: input.id },
      select: { id: true, ownerId: true, archivedAt: true },
    })

    if (!existing) {
      throw new Error("Experience not found")
    }

    if (!canArchiveExperience(user, existing)) {
      throw new ForbiddenError()
    }

    return this.prisma.experience.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
  }
}
