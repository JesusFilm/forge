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

/**
 * Dispatch-fields projection consumed by manager's admin-trigger
 * endpoints (feat-125). Each field is nullable so callers can decide
 * how to classify missing data — manager surfaces `validation_failed`
 * per-item when muxAssetId or subtitleUrl is null. Replaces the
 * Strapi `videos(filters: { coreId: { in } })` query manager used to
 * issue against cms.
 *
 * Wire-shape note: apps/manager/src/lib/admin-video-lookup.ts
 * declares a structurally-identical local `VideoForEnrichment` type
 * (manager consumes the GraphQL projection but isn't yet on
 * @forge/admin-graphql). The two must stay field-for-field in sync;
 * a drift surfaces at runtime only via the `graphql_error` envelope
 * branch on the manager side.
 */
export type VideoForEnrichment = {
  id: string
  coreId: string
  label: string | null
  primaryLanguageBcp47: string | null
  muxAssetId: string | null
  subtitleUrl: string | null
}

export class VideoLookupValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VideoLookupValidationError"
  }
}

/**
 * Maximum coreIds accepted in a single `getByCoreIds` call. Mirrors
 * the receiver-side cap in manager's `admin-trigger-route.ts` so the
 * contract is double-locked.
 */
export const VIDEOS_BY_CORE_IDS_MAX = 100

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

  /**
   * Batched coreId → dispatch-fields lookup. Replaces the Strapi
   * `videos(filters: { coreId: { in } })` call that lived in
   * `apps/manager/src/lib/admin-trigger-route.ts` before feat-125.
   * Server-side picker — admin owns the "best primary-language
   * variant + subtitle" semantics so manager doesn't re-implement.
   *
   * Picker scores subtitles by `(primary ? 0 : 1) + (aiGenerated ? 1 : 0)`,
   * lower wins — preferring `primary=true` non-AI before falling back
   * to any candidate in the primary language. Mirrors the original
   * Strapi-shape picker semantics.
   *
   * Auth is enforced at the resolver via `read:video-metadata`; this
   * method is service-internal and does not re-check (matches the
   * `list`/`getById`/`getBySlug` posture).
   */
  async getByCoreIds({
    coreIds,
  }: {
    coreIds: readonly string[]
  }): Promise<VideoForEnrichment[]> {
    if (coreIds.length === 0) return []
    if (coreIds.length > VIDEOS_BY_CORE_IDS_MAX) {
      throw new VideoLookupValidationError(
        `coreIds.length=${coreIds.length} exceeds max ${VIDEOS_BY_CORE_IDS_MAX}`,
      )
    }

    const rows = await this.prisma.video.findMany({
      where: { coreId: { in: [...coreIds] }, deletedAt: null },
      include: {
        primaryLanguage: { select: { bcp47: true } },
        dubs: {
          where: { deletedAt: null },
          include: {
            language: { select: { bcp47: true } },
            muxVideo: { select: { assetId: true } },
          },
        },
        subtitles: {
          where: { deletedAt: null },
          include: { language: { select: { bcp47: true } } },
        },
      },
    })

    return rows.map((video): VideoForEnrichment => {
      const primaryBcp47 = video.primaryLanguage?.bcp47 ?? null

      let muxAssetId: string | null = null
      if (primaryBcp47 != null) {
        const variantWithMux = video.dubs.find(
          (d) =>
            d.language?.bcp47 === primaryBcp47 &&
            typeof d.muxVideo?.assetId === "string" &&
            d.muxVideo.assetId.length > 0,
        )
        muxAssetId = variantWithMux?.muxVideo?.assetId ?? null
      }

      let subtitleUrl: string | null = null
      if (primaryBcp47 != null) {
        // `.filter()` already returns a fresh array, so the
        // subsequent `.sort()` does not mutate Prisma's result row.
        const candidates = video.subtitles.filter(
          (s) =>
            s.language?.bcp47 === primaryBcp47 &&
            typeof s.vttSrc === "string" &&
            s.vttSrc.length > 0,
        )
        candidates.sort((a, b) => {
          const aScore = (a.primary ? 0 : 1) + (a.aiGenerated ? 1 : 0)
          const bScore = (b.primary ? 0 : 1) + (b.aiGenerated ? 1 : 0)
          return aScore - bScore
        })
        subtitleUrl = candidates[0]?.vttSrc ?? null
      }

      return {
        id: video.id,
        coreId: video.coreId,
        // Normalize to camelCase wire shape (`featureFilm`,
        // `shortFilm`, …) so manager's downstream scene-analysis
        // prompt input matches the pre-feat-125 Strapi-shape
        // exactly. Prisma exposes the enum's TS identifier
        // (`FEATURE_FILM`) but the DB-stored value (per `@map` in
        // schema.prisma) is camelCase; manager's existing pipeline
        // tests pass `videoLabel: "shortFilm"`-style fixtures, so
        // any drift here changes the LLM prompt content.
        label: snakeUpperToCamel(video.label),
        primaryLanguageBcp47: primaryBcp47,
        muxAssetId,
        subtitleUrl,
      }
    })
  }
}

/**
 * Convert Prisma's TS enum identifier (e.g. `FEATURE_FILM`) into
 * the camelCase wire shape Strapi previously emitted (e.g.
 * `featureFilm`). Returns null for null input.
 */
function snakeUpperToCamel(value: string | null): string | null {
  if (value == null) return null
  return value
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}
