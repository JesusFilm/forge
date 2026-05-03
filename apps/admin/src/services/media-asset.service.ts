// Media asset service — permissioned registry for images, videos, PDFs, and
// other uploaded files. The service stores canonical metadata and exposes
// stable routes; storage backends remain an implementation detail.

import type { MediaAssetKind, Prisma, PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { ForbiddenError } from "./errors"
import {
  CreateMediaAssetInput,
  ListMediaAssetsInput,
  UpdateMediaAssetInput,
} from "./media-asset.schemas"
import { scanMediaAssetUsage } from "./media-asset.usage"

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
              { displayName: { contains: input.search, mode: "insensitive" } },
              { description: { contains: input.search, mode: "insensitive" } },
              {
                originalFilename: {
                  contains: input.search,
                  mode: "insensitive",
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
