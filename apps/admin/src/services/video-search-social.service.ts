import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { canEditVideo } from "@/auth/permissions"
import { ForbiddenError } from "./errors"
import { emitRevalidateWebhook } from "./revalidate-webhook"
import { seoVideoLocaleSnapshot } from "./seo-target.service"

const VideoLocaleIdentityInput = z.object({
  videoLocaleId: z.string().trim().min(1).max(191),
})

export function parseVideoSearchSocialLocaleId(raw: unknown): string {
  return VideoLocaleIdentityInput.parse(raw).videoLocaleId
}

const OptionalMetadataText = z.string().max(10_000).nullable()

const SaveVideoSearchSocialInput = VideoLocaleIdentityInput.extend({
  searchTitle: OptionalMetadataText,
  searchDescription: OptionalMetadataText,
  socialImageAssetId: z.string().trim().min(1).max(191).nullable(),
  revisionId: z.string().trim().min(1).max(191).nullable().optional(),
})

const VideoSearchSocialDraftInput = VideoLocaleIdentityInput.extend({
  revisionId: z.string().trim().min(1).max(191),
})

const VideoSearchSocialDraftSnapshot = z.object({
  id: z.string(),
  videoId: z.string(),
  locale: z.string().nullable(),
  updatedAt: z.string().datetime(),
  title: OptionalMetadataText,
  description: OptionalMetadataText,
  snippet: OptionalMetadataText,
  imageAlt: OptionalMetadataText,
  searchTitle: OptionalMetadataText,
  searchDescription: OptionalMetadataText,
  socialImageAssetId: z.string().nullable(),
})

export type VideoSearchSocialSeoDraft =
  | {
      state: "ready"
      revisionId: string
      revisedByKind: "USER" | "AI" | "SYSTEM"
      reason: string | null
      revisedAt: string
      stale: boolean
      changedFields: string[]
      after: z.infer<typeof VideoSearchSocialDraftSnapshot>
    }
  | { state: "draft_missing" }

export type VideoSearchSocialMetadata = {
  videoLocaleId: string
  videoId: string
  slug: string
  locale: string | null
  languageSlug: string | null
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
  sourceTitle: string | null
  sourceDescription: string | null
  searchTitle: string | null
  searchDescription: string | null
  socialImageAssetId: string | null
  seoDraft?: VideoSearchSocialSeoDraft | null
}

export class VideoSearchSocialLocaleNotFoundError extends Error {
  constructor() {
    super("Video locale not found")
    this.name = "VideoSearchSocialLocaleNotFoundError"
  }
}

export class VideoSearchSocialInvalidAssetError extends Error {
  constructor() {
    super("Select a public, ready image from Media Library")
    this.name = "VideoSearchSocialInvalidAssetError"
  }
}

export class VideoSearchSocialDraftNotFoundError extends Error {
  constructor() {
    super("The selected SEO draft is no longer available")
    this.name = "VideoSearchSocialDraftNotFoundError"
  }
}

export class VideoSearchSocialStaleDraftError extends Error {
  constructor() {
    super("The selected SEO draft was based on older canonical content")
    this.name = "VideoSearchSocialStaleDraftError"
  }
}

export class VideoSearchSocialInvalidDraftError extends Error {
  constructor() {
    super("The selected SEO draft has an invalid snapshot")
    this.name = "VideoSearchSocialInvalidDraftError"
  }
}

export type VideoSearchSocialPublicError = {
  ok: false
  code:
    | "FORBIDDEN"
    | "INVALID_INPUT"
    | "INVALID_ASSET"
    | "DRAFT_NOT_FOUND"
    | "STALE_DRAFT"
    | "INVALID_DRAFT"
    | "LOCALE_NOT_FOUND"
    | "SAVE_FAILED"
  message: string
}

/**
 * Convert service failures to a deliberately small, public-safe action shape.
 * Raw validation, Prisma, storage, and webhook details stay in server logs.
 */
export function mapVideoSearchSocialError(
  error: unknown,
): VideoSearchSocialPublicError {
  if (error instanceof ForbiddenError) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "You do not have permission to edit search metadata.",
    }
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Check the submitted search metadata and try again.",
    }
  }
  if (error instanceof VideoSearchSocialInvalidAssetError) {
    return {
      ok: false,
      code: "INVALID_ASSET",
      message: "Select a public, ready image from Media Library.",
    }
  }
  if (error instanceof VideoSearchSocialDraftNotFoundError) {
    return {
      ok: false,
      code: "DRAFT_NOT_FOUND",
      message: "This SEO draft is no longer available. Reload and try again.",
    }
  }
  if (error instanceof VideoSearchSocialStaleDraftError) {
    return {
      ok: false,
      code: "STALE_DRAFT",
      message:
        "Canonical content changed after this SEO draft was created. Discard it or reload before continuing.",
    }
  }
  if (error instanceof VideoSearchSocialInvalidDraftError) {
    return {
      ok: false,
      code: "INVALID_DRAFT",
      message:
        "This SEO draft cannot be applied. Discard it and request a new proposal.",
    }
  }
  if (error instanceof VideoSearchSocialLocaleNotFoundError) {
    return {
      ok: false,
      code: "LOCALE_NOT_FOUND",
      message:
        "This video locale is no longer available. Reload and try again.",
    }
  }
  return {
    ok: false,
    code: "SAVE_FAILED",
    message: "Search metadata could not be saved. Please try again.",
  }
}

const videoLocaleSelect = {
  id: true,
  videoId: true,
  locale: true,
  languageSlug: true,
  status: true,
  title: true,
  description: true,
  searchTitle: true,
  searchDescription: true,
  socialImageAssetId: true,
  video: { select: { slug: true } },
} satisfies Prisma.VideoLocaleSelect

export class VideoSearchSocialService {
  constructor(private prisma: PrismaClient) {}

  async get({ user, input: raw }: { user: Principal | null; input: unknown }) {
    assertCanEditVideoSearchSocial(user)
    const videoLocaleId = parseVideoSearchSocialLocaleId(raw)

    const locale = await this.prisma.videoLocale.findFirst({
      where: {
        id: videoLocaleId,
        deletedAt: null,
        status: { not: "ARCHIVED" },
        video: { deletedAt: null },
      },
      select: videoLocaleSelect,
    })
    if (!locale) throw new VideoSearchSocialLocaleNotFoundError()
    return toMetadata(locale)
  }

  async save({ user, input: raw }: { user: Principal | null; input: unknown }) {
    // This gate intentionally runs before Zod parses the resource id and before
    // Prisma is touched, so unauthorized callers cannot probe locale/asset ids.
    assertCanEditVideoSearchSocial(user)
    const input = SaveVideoSearchSocialInput.parse(raw)
    if (input.revisionId) {
      return this.saveDraft({
        user,
        input: { ...input, revisionId: input.revisionId },
      })
    }
    const next = {
      searchTitle: trimToNull(input.searchTitle),
      searchDescription: trimToNull(input.searchDescription),
      socialImageAssetId: input.socialImageAssetId ?? null,
    }

    const committed = await this.prisma.$transaction(
      async (tx) => {
        const locale = await tx.videoLocale.findFirst({
          where: {
            id: input.videoLocaleId,
            deletedAt: null,
            status: { not: "ARCHIVED" },
            video: { deletedAt: null },
          },
          select: videoLocaleSelect,
        })
        if (!locale) throw new VideoSearchSocialLocaleNotFoundError()

        if (next.socialImageAssetId) {
          const asset = await tx.mediaAsset.findFirst({
            where: {
              id: next.socialImageAssetId,
              kind: "IMAGE",
              status: "READY",
              visibility: "PUBLIC",
              OR: [
                { objectKey: { not: null } },
                { previewObjectKey: { not: null } },
              ],
            },
            select: { id: true },
          })
          if (!asset) throw new VideoSearchSocialInvalidAssetError()
        }

        const update = await tx.videoLocale.updateMany({
          where: {
            id: locale.id,
            deletedAt: null,
            status: { not: "ARCHIVED" },
            video: { deletedAt: null },
          },
          data: next,
        })
        if (update.count !== 1) throw new VideoSearchSocialLocaleNotFoundError()

        return {
          metadata: toMetadata({ ...locale, ...next }),
          previous: {
            searchTitle: locale.searchTitle,
            searchDescription: locale.searchDescription,
            socialImageAssetId: locale.socialImageAssetId,
          },
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    let revalidation: "not_published" | "missing_language_slug" | "dispatched" =
      "not_published"
    if (committed.metadata.status === "PUBLISHED") {
      if (committed.metadata.languageSlug) {
        revalidation = "dispatched"
        void emitRevalidateWebhook({
          model: "video",
          slug: committed.metadata.slug,
          locale: committed.metadata.locale,
          languageSlug: committed.metadata.languageSlug,
        })
      } else {
        revalidation = "missing_language_slug"
      }
    }

    const changedFields = (
      ["searchTitle", "searchDescription", "socialImageAssetId"] as const
    ).filter((field) => committed.previous[field] !== committed.metadata[field])

    // Audit only identities and changed field names. Search copy and raw
    // exceptions are intentionally excluded from this public-metadata event.
    console.log(
      JSON.stringify({
        event: "video_search_social.updated",
        actorId: user?.id ?? null,
        videoId: committed.metadata.videoId,
        videoLocaleId: committed.metadata.videoLocaleId,
        locale: committed.metadata.locale,
        languageSlug: committed.metadata.languageSlug,
        publicationState: committed.metadata.status,
        changedFields,
        selectedAssetId: committed.metadata.socialImageAssetId,
        revalidation,
        result: "success",
      }),
    )

    return committed.metadata
  }

  async publishDraft({
    user,
    input: raw,
  }: {
    user: Principal | null
    input: unknown
  }) {
    assertCanEditVideoSearchSocial(user)
    const input = VideoSearchSocialDraftInput.parse(raw)

    const committed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM video_locale WHERE id = ${input.videoLocaleId} FOR UPDATE`,
        )
        const locale = await tx.videoLocale.findFirst({
          where: {
            id: input.videoLocaleId,
            deletedAt: null,
            status: { not: "ARCHIVED" },
            video: { deletedAt: null },
          },
          include: { video: { select: { slug: true } } },
        })
        if (!locale) throw new VideoSearchSocialLocaleNotFoundError()

        const revision = await tx.contentRevision.findFirst({
          where: {
            id: input.revisionId,
            entityType: "VideoLocale",
            entityId: locale.id,
            status: "DRAFT",
          },
          select: { id: true, snapshot: true },
        })
        if (!revision) throw new VideoSearchSocialDraftNotFoundError()
        const after = parseDraftSnapshot(revision.snapshot, locale)
        await assertValidSocialAsset(tx, after.socialImageAssetId)

        const appliedAt = new Date()
        await tx.contentRevision.create({
          data: {
            entityType: "VideoLocale",
            entityId: locale.id,
            snapshot: {
              v: 1,
              data: seoVideoLocaleSnapshot(locale),
            },
            status: "HISTORICAL",
            revisedBy: user?.id ?? null,
            revisedByKind: "USER",
            reason: "Canonical snapshot before approved SEO draft publish",
          },
        })
        const updated = await tx.videoLocale.update({
          where: { id: locale.id },
          data: editableDraftFields(after),
          include: { video: { select: { slug: true } } },
        })
        await tx.contentRevision.update({
          where: { id: revision.id },
          data: { status: "HISTORICAL", appliedAt },
        })

        return toMetadata(updated, null)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )

    if (committed.status === "PUBLISHED" && committed.languageSlug) {
      void emitRevalidateWebhook({
        model: "video",
        slug: committed.slug,
        locale: committed.locale,
        languageSlug: committed.languageSlug,
      })
    }
    return committed
  }

  async discardDraft({
    user,
    input: raw,
  }: {
    user: Principal | null
    input: unknown
  }) {
    assertCanEditVideoSearchSocial(user)
    const input = VideoSearchSocialDraftInput.parse(raw)
    const discarded = await this.prisma.contentRevision.updateMany({
      where: {
        id: input.revisionId,
        entityType: "VideoLocale",
        entityId: input.videoLocaleId,
        status: "DRAFT",
      },
      data: { status: "DISCARDED" },
    })
    if (discarded.count !== 1) {
      throw new VideoSearchSocialDraftNotFoundError()
    }
    return { revisionId: input.revisionId, status: "DISCARDED" as const }
  }

  private async saveDraft({
    user,
    input,
  }: {
    user: Principal | null
    input: z.infer<typeof SaveVideoSearchSocialInput> & { revisionId: string }
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM video_locale WHERE id = ${input.videoLocaleId} FOR UPDATE`,
        )
        const locale = await tx.videoLocale.findFirst({
          where: {
            id: input.videoLocaleId,
            deletedAt: null,
            status: { not: "ARCHIVED" },
            video: { deletedAt: null },
          },
          include: { video: { select: { slug: true } } },
        })
        if (!locale) throw new VideoSearchSocialLocaleNotFoundError()
        const revision = await tx.contentRevision.findFirst({
          where: {
            id: input.revisionId,
            entityType: "VideoLocale",
            entityId: locale.id,
            status: "DRAFT",
          },
        })
        if (!revision) throw new VideoSearchSocialDraftNotFoundError()
        const current = parseDraftSnapshot(revision.snapshot, locale)
        const after = VideoSearchSocialDraftSnapshot.parse({
          ...current,
          searchTitle: trimToNull(input.searchTitle),
          searchDescription: trimToNull(input.searchDescription),
          socialImageAssetId: input.socialImageAssetId ?? null,
        })
        await assertValidSocialAsset(tx, after.socialImageAssetId)
        const revisedAt = new Date()
        await tx.contentRevision.update({
          where: { id: revision.id },
          data: {
            snapshot: { v: 1, data: after },
            revisedBy: user?.id ?? null,
            revisedByKind: "USER",
            reason: "Approved SEO draft edited in Admin",
            revisedAt,
          },
        })
        const seoDraft = toSeoDraft({
          revision: {
            ...revision,
            snapshot: { v: 1, data: after },
            revisedByKind: "USER",
            reason: "Approved SEO draft edited in Admin",
            revisedAt,
          },
          canonical: locale,
        })
        return toMetadata(
          { ...locale, ...editableDraftFields(after) },
          seoDraft,
        )
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  }
}

function assertCanEditVideoSearchSocial(user: Principal | null) {
  if (!canEditVideo(user)) throw new ForbiddenError()
}

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function snapshotData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return record.v === 1 ? record.data : null
}

function parseDraftSnapshot(
  value: unknown,
  locale: {
    id: string
    videoId: string
    locale: string | null
    updatedAt: Date
  },
  requireCurrent = true,
) {
  const parsed = VideoSearchSocialDraftSnapshot.safeParse(snapshotData(value))
  if (!parsed.success) throw new VideoSearchSocialInvalidDraftError()
  if (
    parsed.data.id !== locale.id ||
    parsed.data.videoId !== locale.videoId ||
    parsed.data.locale !== locale.locale
  ) {
    throw new VideoSearchSocialInvalidDraftError()
  }
  if (
    requireCurrent &&
    parsed.data.updatedAt !== locale.updatedAt.toISOString()
  ) {
    throw new VideoSearchSocialStaleDraftError()
  }
  return parsed.data
}

function editableDraftFields(
  snapshot: z.infer<typeof VideoSearchSocialDraftSnapshot>,
) {
  return {
    title: snapshot.title,
    description: snapshot.description,
    snippet: snapshot.snippet,
    imageAlt: snapshot.imageAlt,
    searchTitle: snapshot.searchTitle,
    searchDescription: snapshot.searchDescription,
    socialImageAssetId: snapshot.socialImageAssetId,
  }
}

async function assertValidSocialAsset(
  tx: Prisma.TransactionClient,
  assetId: string | null,
) {
  if (!assetId) return
  const asset = await tx.mediaAsset.findFirst({
    where: {
      id: assetId,
      kind: "IMAGE",
      status: "READY",
      visibility: "PUBLIC",
      OR: [{ objectKey: { not: null } }, { previewObjectKey: { not: null } }],
    },
    select: { id: true },
  })
  if (!asset) throw new VideoSearchSocialInvalidAssetError()
}

export function toSeoDraft({
  revision,
  canonical,
}: {
  revision: {
    id: string
    snapshot: unknown
    revisedByKind: "USER" | "AI" | "SYSTEM"
    reason: string | null
    revisedAt: Date
  }
  canonical: {
    id: string
    videoId: string
    locale: string | null
    updatedAt: Date
    title: string | null
    description: string | null
    snippet: string | null
    imageAlt: string | null
    searchTitle: string | null
    searchDescription: string | null
    socialImageAssetId: string | null
  }
}): VideoSearchSocialSeoDraft {
  const after = parseDraftSnapshot(revision.snapshot, canonical, false)
  const fields = Object.keys(editableDraftFields(after)) as Array<
    keyof ReturnType<typeof editableDraftFields>
  >
  return {
    state: "ready",
    revisionId: revision.id,
    revisedByKind: revision.revisedByKind,
    reason: revision.reason,
    revisedAt: revision.revisedAt.toISOString(),
    stale: after.updatedAt !== canonical.updatedAt.toISOString(),
    changedFields: fields.filter((field) => canonical[field] !== after[field]),
    after,
  }
}

function toMetadata(
  locale: {
    id: string
    videoId: string
    locale: string | null
    languageSlug: string | null
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
    title: string | null
    description: string | null
    searchTitle: string | null
    searchDescription: string | null
    socialImageAssetId: string | null
    video: { slug: string }
  },
  seoDraft?: VideoSearchSocialSeoDraft | null,
): VideoSearchSocialMetadata {
  return {
    videoLocaleId: locale.id,
    videoId: locale.videoId,
    slug: locale.video.slug,
    locale: locale.locale,
    languageSlug: locale.languageSlug,
    status: locale.status,
    sourceTitle: locale.title,
    sourceDescription: locale.description,
    searchTitle: locale.searchTitle,
    searchDescription: locale.searchDescription,
    socialImageAssetId: locale.socialImageAssetId,
    seoDraft,
  }
}
