import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { canEditVideo } from "@/auth/permissions"
import { ForbiddenError } from "./errors"
import {
  emitRevalidateWebhook,
  type RevalidateOutcome,
} from "./revalidate-webhook"

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
})

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

export type VideoSearchSocialPublicError = {
  ok: false
  code:
    | "FORBIDDEN"
    | "INVALID_INPUT"
    | "INVALID_ASSET"
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

    let revalidation:
      | "not_published"
      | "missing_language_slug"
      | RevalidateOutcome["status"] = "not_published"
    if (committed.metadata.status === "PUBLISHED") {
      if (committed.metadata.languageSlug) {
        const outcome = await emitRevalidateWebhook({
          model: "video",
          slug: committed.metadata.slug,
          locale: committed.metadata.locale,
          languageSlug: committed.metadata.languageSlug,
        })
        revalidation = outcome.status
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
}

function assertCanEditVideoSearchSocial(user: Principal | null) {
  if (!canEditVideo(user)) throw new ForbiddenError()
}

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function toMetadata(locale: {
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
}): VideoSearchSocialMetadata {
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
  }
}
