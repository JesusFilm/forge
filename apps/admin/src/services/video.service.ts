// Video service — read-only in v1. Writes come via Core sync (Unit 10).
//
// Videos are public-shape (Core-sourced, read-only at GraphQL layer).
//
// Auth contract (post consumer-migration U2 — 2026-05-11):
//   - `list`, `getById`, `getBySlug` are exposed via PUBLIC GraphQL resolvers
//     in `apps/admin/src/graphql/types/video.ts`. The resolver's
//     `authScopes: { public: true }` is the single auth contract for these
//     three methods. Service-layer `hasPermission` defense-in-depth was
//     dropped intentionally — keeping it would 403 anonymous callers after
//     the resolver lets them through, making the widening a hidden no-op.
//     Any future re-addition of the `hasPermission` guard here will
//     break the regression assertions in `video.service.test.ts` flipping
//     PUBLIC from Forbidden → resolution.
//   - `getByCoreId` is NOT exposed via GraphQL; it is called by Core sync
//     internals via service-to-service paths. Its `hasPermission` guard
//     stays — it is the only auth wall for that method.

import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"

export class VideoService {
  constructor(private prisma: PrismaClient) {}

  async list({
    input: raw,
    user: _user,
    query,
  }: {
    input: { limit?: number; offset?: number }
    user: Principal | null
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

  async getById({
    id,
    user: _user,
    query,
  }: {
    id: string
    user: Principal | null
    query: object
  }) {
    return this.prisma.video.findFirst({
      ...query,
      where: { id, deletedAt: null },
    })
  }

  async getBySlug({
    slug,
    user: _user,
    query,
  }: {
    slug: string
    user: Principal | null
    query: object
  }) {
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
    // Service-to-service path (Core sync internals). Not exposed via GraphQL.
    // Auth wall lives here, not at any resolver.
    if (!hasPermission(user, "read:videos")) {
      throw new ForbiddenError()
    }

    return this.prisma.video.findFirst({
      ...query,
      where: { coreId, deletedAt: null },
    })
  }
}
