// Video service — read-only in v1. Writes come via Core sync (Unit 10).
//
// Auth contract (consumer-migration U2 — 2026-05-11): `list`/`getById`/
// `getBySlug` are exposed via PUBLIC resolvers in
// `apps/admin/src/graphql/types/video.ts:316,332,346`; the resolver's
// `authScopes: { public: true }` is the sole auth wall — re-adding a
// service-layer `hasPermission` guard would 403 anonymous callers and
// breaks `video.service.test.ts:52`. `getByCoreId` is service-to-service
// only (Core sync internals) and keeps its guard.

import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

export class VideoService {
  constructor(private prisma: PrismaClient) {}

  async list({
    input: raw,
    query,
  }: {
    input: { limit?: number; offset?: number }
    query: object
  }) {
    return this.prisma.video.findMany({
      ...query,
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: Math.min(raw.limit ?? 50, 200),
      skip: raw.offset ?? 0,
    })
  }

  async getById({ id, query }: { id: string; query: object }) {
    return this.prisma.video.findFirst({
      ...query,
      where: { id, deletedAt: null },
    })
  }

  async getBySlug({ slug, query }: { slug: string; query: object }) {
    return this.prisma.video.findFirst({
      ...query,
      where: { slug, deletedAt: null },
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
    // Service-to-service only (Core sync). Auth wall lives here, not at a resolver.
    if (!hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findFirst({
      ...query,
      where: { coreId, deletedAt: null },
    })
  }
}
