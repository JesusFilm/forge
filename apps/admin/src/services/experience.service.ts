// Experience service — CRUD + list + getBySlug.
//
// Mutation methods: (1) Zod parse input, (2) ABAC check, (3) Prisma call.
// Read methods: (1) tier check, (2) role-based WHERE filtering, (3) Prisma call.
// Resolvers delegate here; they never call Prisma directly for mutations.

import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  hasPermission,
  canEditExperienceLocale,
  canPublishExperienceLocale,
  canArchiveExperience,
} from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "./errors"
import { runExperienceEmbedding } from "@/workflows/experienceEmbedding"
import {
  CreateExperienceInput,
  UpdateExperienceLocaleInput,
  PublishExperienceLocaleInput,
  ArchiveExperienceInput,
} from "./experience.schemas"

function isPrivileged(user: Principal | null): boolean {
  return user?.role === "ADMIN" || user?.role === "EDITOR"
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
    // Defense-in-depth: also checked by scope-auth at the resolver layer.
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
    // Defense-in-depth: also checked by scope-auth at the resolver layer.
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }

    const includeArchived = raw.includeArchived && isPrivileged(user)

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
    // Defense-in-depth: also checked by scope-auth at the resolver layer.
    if (!hasPermission(user, "read:experiences")) {
      throw new ForbiddenError()
    }

    const where: Record<string, unknown> = { id }
    if (!isPrivileged(user)) {
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
    const where: Record<string, unknown> = { locale, slug }

    // PUBLIC and VIEWER see published only + exclude archived parents.
    // EDITOR and ADMIN see all statuses including drafts.
    if (!isPrivileged(user)) {
      where.status = "PUBLISHED"
      where.experience = { archivedAt: null }
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
      throw new NotFoundError("Experience", input.id)
    }

    if (!canArchiveExperience(user, existing)) {
      throw new ForbiddenError()
    }

    return this.prisma.experience.update({
      where: { id: input.id },
      data: { archivedAt: new Date() },
    })
  }

  async triggerEmbedding({
    localeId,
    user,
  }: {
    localeId: string
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }

    const locale = await this.prisma.experienceLocale.findUniqueOrThrow({
      where: { id: localeId },
      include: {
        experience: {
          select: {
            ownerId: true,
            archivedAt: true,
          },
        },
      },
    })

    if (!canEditExperienceLocale(user, locale)) {
      throw new ForbiddenError()
    }

    return runExperienceEmbedding({ localeId })
  }
}
