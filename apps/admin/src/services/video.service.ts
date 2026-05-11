// Video service — read-only in v1. Writes come via Core sync (Unit 10).
//
// Videos are public-shape (Core-sourced, read-only at GraphQL layer).
// Tier-only auth gate: VIEWER+ can list/read; no ABAC ownership checks.

import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

export class VideoService {
  constructor(private prisma: PrismaClient) {}

  async list({
    input: raw,
    user,
    query,
  }: {
    input: { limit?: number; offset?: number }
    user: Principal | null
    query: object
  }) {
    if (!hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findMany({
      ...query,
      where: { deletedAt: null },
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
    if (!hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findFirst({
      ...query,
      where: { id, deletedAt: null },
    })
  }

  async getBySlug({
    slug,
    user,
    query,
    allowPublic = false,
    publicLocale,
  }: {
    slug: string
    user: Principal | null
    query: object
    allowPublic?: boolean
    publicLocale?: string
  }) {
    if (!allowPublic && !hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findFirst({
      ...query,
      where: {
        slug,
        deletedAt: null,
        ...(allowPublic && publicLocale
          ? {
              locales: {
                some: { locale: publicLocale, status: "PUBLISHED" },
              },
            }
          : {}),
      },
    })
  }

  async getByCoreId({
    coreId,
    user,
    query,
  }: {
    coreId: string
    user: Principal | null
    query: object
  }) {
    if (!hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findFirst({
      ...query,
      where: { coreId, deletedAt: null },
    })
  }
}
