// Media asset service — permissioned registry for images, videos, PDFs, and
// other uploaded files. User-facing metadata lives in localized rows; storage
// backends remain an implementation detail.

import type { MediaAssetKind, Prisma, PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { canWriteDerived, hasPermission } from "@/auth/permissions"
import { getAdminBaseURL } from "@/auth/origins"
import { normalizeLegacyExperienceBlockMediaFields } from "@/domain/blocks"
import { ForbiddenError } from "./errors"
import {
  CreateMediaAssetInput,
  ListMediaAssetsInput,
  UpdateMediaAssetLocaleInput,
  UpdateMediaAssetInput,
  UpsertAiMediaAssetLocaleInput,
} from "./media-asset.schemas"
import { scanMediaAssetUsage } from "./media-asset.usage"

export const TOP_GLOBAL_IMAGE_LOCALES = [
  "en",
  "es",
  "pt",
  "fr",
  "ar",
  "zh",
  "hi",
  "id",
  "ru",
  "bn",
  "de",
  "ja",
] as const

export class MediaAssetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaAssetValidationError"
  }
}

export class MediaAssetService {
  constructor(private prisma: PrismaClient) {}

  async list({
    input: raw,
    user,
    query,
  }: {
    input: unknown
    user: Principal | null
    query: object
  }) {
    if (!hasPermission(user, "read:media-assets")) {
      throw new ForbiddenError()
    }

    const input = ListMediaAssetsInput.parse(raw)
    const where: Prisma.MediaAssetWhereInput = {
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.backend ? { backend: input.backend } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.search
        ? {
            OR: [
              {
                originalFilename: {
                  contains: input.search,
                  mode: "insensitive",
                },
              },
              {
                locales: {
                  some: {
                    displayName: {
                      contains: input.search,
                      mode: "insensitive",
                    },
                  },
                },
              },
            ],
          }
        : {}),
    }

    return this.prisma.mediaAsset.findMany({
      ...query,
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
      skip: input.offset ?? 0,
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
    if (!hasPermission(user, "read:media-assets")) {
      throw new ForbiddenError()
    }

    return this.prisma.mediaAsset.findFirst({
      ...query,
      where: { id },
    })
  }

  async create({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:media-assets")) {
      throw new ForbiddenError()
    }

    const input = CreateMediaAssetInput.parse(raw)
    validateMimeKind(input.kind, input.mimeType)
    validateBackendShape(input)
    await assertFolderExists(this.prisma, input.folderId ?? null)

    return this.prisma.mediaAsset.create({
      data: {
        ...input,
        imageEnrichmentStatus:
          input.imageEnrichmentStatus ??
          (input.kind === "IMAGE" ? "WAITING" : "SKIPPED"),
        createdById: user?.id ?? null,
      },
    })
  }

  async update({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:media-assets")) {
      throw new ForbiddenError()
    }

    const input = UpdateMediaAssetInput.parse(raw)
    const { id, ...data } = input
    await assertFolderExists(this.prisma, input.folderId ?? null)

    return this.prisma.mediaAsset.update({
      where: { id },
      data,
    })
  }

  async listImageLocales({
    mediaAssetId,
    user,
  }: {
    mediaAssetId: string
    user: Principal | null
  }) {
    if (!hasPermission(user, "read:media-assets")) {
      throw new ForbiddenError()
    }

    return this.prisma.mediaAssetLocale.findMany({
      where: { mediaAssetId },
      orderBy: { locale: "asc" },
    })
  }

  async updateImageLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!hasPermission(user, "write:media-assets")) {
      throw new ForbiddenError()
    }

    const input = UpdateMediaAssetLocaleInput.parse(raw)
    await this.assertMediaAsset(input.mediaAssetId)

    const data: Prisma.MediaAssetLocaleUpdateInput = {
      status: "COMPLETE",
      errorCode: null,
      errorMessage: null,
    }

    if (input.displayName !== undefined) {
      data.displayName = input.displayName
      data.displayNameSource = "USER"
      data.displayNameLocked = true
    }

    if (input.altText !== undefined) {
      data.altText = input.altText
      data.altTextSource = "USER"
      data.altTextLocked = true
    }

    return this.prisma.mediaAssetLocale.upsert({
      where: {
        mediaAssetId_locale: {
          mediaAssetId: input.mediaAssetId,
          locale: input.locale,
        },
      },
      create: {
        mediaAssetId: input.mediaAssetId,
        locale: input.locale,
        displayName: input.displayName ?? null,
        altText: input.altText ?? null,
        displayNameSource: input.displayName !== undefined ? "USER" : null,
        altTextSource: input.altText !== undefined ? "USER" : null,
        displayNameLocked: input.displayName !== undefined,
        altTextLocked: input.altText !== undefined,
        status: "COMPLETE",
      },
      update: data,
    })
  }

  async upsertAiImageLocale({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    if (!canWriteDerived(user)) {
      throw new ForbiddenError()
    }

    const input = UpsertAiMediaAssetLocaleInput.parse(raw)
    const existing = await this.prisma.mediaAssetLocale.findUnique({
      where: {
        mediaAssetId_locale: {
          mediaAssetId: input.mediaAssetId,
          locale: input.locale,
        },
      },
    })

    const nextDisplayName =
      existing?.displayNameLocked === true
        ? existing.displayName
        : (input.displayName ?? null)
    const nextAltText =
      existing?.altTextLocked === true
        ? existing.altText
        : (input.altText ?? null)

    const displayNameSource =
      existing?.displayNameLocked === true
        ? existing.displayNameSource
        : input.displayName !== undefined
          ? "AI"
          : (existing?.displayNameSource ?? null)
    const altTextSource =
      existing?.altTextLocked === true
        ? existing.altTextSource
        : input.altText !== undefined
          ? "AI"
          : (existing?.altTextSource ?? null)

    return this.prisma.mediaAssetLocale.upsert({
      where: {
        mediaAssetId_locale: {
          mediaAssetId: input.mediaAssetId,
          locale: input.locale,
        },
      },
      create: {
        mediaAssetId: input.mediaAssetId,
        locale: input.locale,
        displayName: input.displayName ?? null,
        altText: input.altText ?? null,
        displayNameSource: input.displayName !== undefined ? "AI" : null,
        altTextSource: input.altText !== undefined ? "AI" : null,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        generatedAt: input.status === "COMPLETE" ? new Date() : null,
      },
      update: {
        displayName: nextDisplayName,
        altText: nextAltText,
        displayNameSource,
        altTextSource,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        generatedAt: input.status === "COMPLETE" ? new Date() : undefined,
      },
    })
  }

  async seedTopImageLocales({
    mediaAssetId,
    user,
  }: {
    mediaAssetId: string
    user: Principal | null
  }) {
    if (!canWriteDerived(user)) {
      throw new ForbiddenError()
    }

    await this.assertImageAsset(mediaAssetId)

    await Promise.all(
      TOP_GLOBAL_IMAGE_LOCALES.map((locale) =>
        this.prisma.mediaAssetLocale.upsert({
          where: { mediaAssetId_locale: { mediaAssetId, locale } },
          create: { mediaAssetId, locale, status: "WAITING" },
          update: {},
        }),
      ),
    )
  }

  async updateImageEnrichmentState({
    mediaAssetId,
    user,
    data,
  }: {
    mediaAssetId: string
    user: Principal | null
    data: Partial<
      Pick<
        Prisma.MediaAssetUpdateInput,
        | "blurDataUrl"
        | "dominantColor"
        | "width"
        | "height"
        | "imageEnrichmentStatus"
        | "imageEnrichmentErrorCode"
        | "imageEnrichmentErrorMessage"
        | "imageEnrichmentStartedAt"
        | "imageEnrichmentCompletedAt"
      >
    >
  }) {
    if (!canWriteDerived(user)) {
      throw new ForbiddenError()
    }

    return this.prisma.mediaAsset.updateMany({
      where: { id: mediaAssetId },
      data,
    })
  }

  async delete({ id, user }: { id: string; user: Principal | null }) {
    if (!hasPermission(user, "delete:media-assets")) {
      throw new ForbiddenError()
    }

    const usage = await this.usage({ id, user })
    if (usage.length > 0) {
      throw new MediaAssetValidationError(
        "Cannot delete a media asset while it is still used",
      )
    }

    await this.prisma.mediaAsset.delete({ where: { id } })
    return { deleted: true, usageCount: 0 }
  }

  async usage({ id, user }: { id: string; user: Principal | null }) {
    if (!hasPermission(user, "read:media-assets")) {
      throw new ForbiddenError()
    }

    const asset = await this.prisma.mediaAsset.findFirst({ where: { id } })
    if (!asset) return []

    const previewUrl = mediaAssetPreviewUrl(asset)
    const downloadUrl = mediaAssetDownloadUrl(asset)

    return scanMediaAssetUsage(this.prisma, {
      assetId: asset.id,
      urls: [previewUrl, downloadUrl].filter((value): value is string =>
        Boolean(value),
      ),
      objectKeys: [asset.objectKey, asset.previewObjectKey].filter(
        (value): value is string => Boolean(value),
      ),
    })
  }

  async hydratePublicUrlsInBlocks(blocks: unknown): Promise<unknown> {
    const normalizedBlocks = normalizeLegacyExperienceBlockMediaFields(blocks)
    const assetIds = Array.from(collectBlockMediaAssetIds(normalizedBlocks))
    if (assetIds.length === 0) {
      return normalizedBlocks
    }

    const assets = await this.prisma.mediaAsset.findMany({
      where: {
        id: { in: assetIds },
        status: "READY",
        visibility: "PUBLIC",
      },
      select: {
        id: true,
        backend: true,
        status: true,
        visibility: true,
        objectKey: true,
        previewObjectKey: true,
        muxPlaybackId: true,
      },
    })
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]))

    return hydrateBlockMediaAssetUrls(normalizedBlocks, assetsById)
  }

  private async assertMediaAsset(id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id },
      select: { id: true, kind: true },
    })
    if (!asset) {
      throw new MediaAssetValidationError("Media asset not found")
    }
  }

  private async assertImageAsset(id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id },
      select: { id: true, kind: true },
    })
    if (!asset || asset.kind !== "IMAGE") {
      throw new MediaAssetValidationError(
        "Image enrichment requires an image asset",
      )
    }
  }
}

export function mediaAssetPreviewUrl(asset: {
  id: string
  backend: string
  objectKey: string | null
  previewObjectKey: string | null
  muxPlaybackId: string | null
}) {
  if (asset.muxPlaybackId) {
    return `https://image.mux.com/${asset.muxPlaybackId}/thumbnail.jpg`
  }
  if (asset.previewObjectKey || asset.objectKey) {
    return `/api/media-assets/${asset.id}/preview`
  }
  return null
}

export function mediaAssetDownloadUrl(asset: {
  id: string
  backend: string
  objectKey: string | null
}) {
  if (asset.backend === "MUX") {
    return null
  }
  return asset.objectKey ? `/api/media-assets/${asset.id}/download` : null
}

export function publicMediaAssetPreviewUrl(
  asset: {
    id: string
    backend: string
    status: string
    visibility: string
    objectKey: string | null
    previewObjectKey: string | null
    muxPlaybackId: string | null
  },
  baseUrl = getAdminBaseURL(),
) {
  if (asset.status !== "READY" || asset.visibility !== "PUBLIC") {
    return null
  }
  if (asset.muxPlaybackId) {
    return `https://image.mux.com/${asset.muxPlaybackId}/thumbnail.jpg`
  }
  if (
    asset.backend === "MUX" ||
    (!asset.previewObjectKey && !asset.objectKey)
  ) {
    return null
  }

  const origin = new URL(baseUrl).origin
  return `${origin}/api/public/media-assets/${encodeURIComponent(asset.id)}/preview`
}

const BLOCK_MEDIA_ASSET_URL_FIELDS = [
  ["backgroundImageAssetId", "backgroundImageUrl"],
  ["imageAssetId", "imageUrl"],
  ["mediaAssetId", "mediaUrl"],
] as const

function collectBlockMediaAssetIds(value: unknown, ids = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBlockMediaAssetIds(item, ids)
    }
    return ids
  }

  if (!isRecord(value)) {
    return ids
  }

  for (const [assetField] of BLOCK_MEDIA_ASSET_URL_FIELDS) {
    const assetId = value[assetField]
    if (typeof assetId === "string" && assetId.trim().length > 0) {
      ids.add(assetId)
    }
  }

  for (const nested of Object.values(value)) {
    collectBlockMediaAssetIds(nested, ids)
  }

  return ids
}

function hydrateBlockMediaAssetUrls(
  value: unknown,
  assetsById: Map<
    string,
    {
      id: string
      backend: string
      status: string
      visibility: string
      objectKey: string | null
      previewObjectKey: string | null
      muxPlaybackId: string | null
    }
  >,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateBlockMediaAssetUrls(item, assetsById))
  }

  if (!isRecord(value)) {
    return value
  }

  const next: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    next[key] = hydrateBlockMediaAssetUrls(nested, assetsById)
  }

  for (const [assetField, urlField] of BLOCK_MEDIA_ASSET_URL_FIELDS) {
    const assetId = next[assetField]
    if (typeof assetId !== "string") {
      continue
    }

    const publicUrl = publicMediaAssetPreviewUrl(
      assetsById.get(assetId) ?? {
        id: assetId,
        backend: "",
        status: "",
        visibility: "",
        objectKey: null,
        previewObjectKey: null,
        muxPlaybackId: null,
      },
    )
    if (publicUrl) {
      next[urlField] = publicUrl
    } else if (isPrivateMediaAssetUrl(next[urlField])) {
      delete next[urlField]
    }
  }

  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPrivateMediaAssetUrl(value: unknown) {
  return (
    typeof value === "string" &&
    (value.startsWith("/api/media-assets/") ||
      value.includes("/api/media-assets/"))
  )
}

function validateMimeKind(kind: MediaAssetKind, mimeType: string) {
  const ok =
    kind === "FILE" ||
    (kind === "IMAGE" && mimeType.startsWith("image/")) ||
    (kind === "VIDEO" && mimeType.startsWith("video/")) ||
    (kind === "PDF" && mimeType === "application/pdf")

  if (!ok) {
    throw new MediaAssetValidationError(
      `MIME type ${mimeType} does not match media kind ${kind}`,
    )
  }
}

function validateBackendShape(input: CreateMediaAssetInput) {
  if (input.backend === "MUX" && input.kind !== "VIDEO") {
    throw new MediaAssetValidationError("Mux media assets must be videos")
  }

  if (input.backend === "MUX" && !input.muxAssetId && !input.muxUploadId) {
    throw new MediaAssetValidationError(
      "Mux media assets require muxAssetId or muxUploadId",
    )
  }
}

async function assertFolderExists(
  prisma: PrismaClient,
  folderId: string | null,
) {
  if (!folderId) {
    return
  }

  const folder = await prisma.mediaFolder.findFirst({
    where: { id: folderId },
    select: { id: true },
  })

  if (!folder) {
    throw new MediaAssetValidationError("Media folder not found")
  }
}
