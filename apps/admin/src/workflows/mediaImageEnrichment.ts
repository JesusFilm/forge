import { Buffer } from "node:buffer"
import { prisma } from "@/db/client"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import {
  MediaAssetService,
  TOP_GLOBAL_IMAGE_LOCALES,
} from "@/services/media-asset.service"
import { generateImageMetadata } from "@/services/image-metadata.service"
import { generateLocalizedImageText } from "@/services/image-text-generation.service"
import { readMediaObject } from "@/storage/media"

export type MediaImageEnrichmentInput = {
  mediaAssetId: string
}

export type MediaImageEnrichmentOutput = {
  mediaAssetId: string
  blurUpdated: boolean
  localeCount: number
  textStatus: "generated" | "skipped"
}

type EnrichmentAsset = {
  id: string
  kind: "IMAGE" | "VIDEO" | "PDF" | "FILE"
  backend: "LOCAL" | "S3" | "MUX"
  objectKey: string | null
  mimeType: string
  originalFilename: string | null
}

export async function runMediaImageEnrichment(
  input: MediaImageEnrichmentInput,
): Promise<MediaImageEnrichmentOutput> {
  "use workflow"

  await stepMarkProcessing(input.mediaAssetId)
  const asset = await stepLoadAsset(input.mediaAssetId)
  await stepSeedLocales(input.mediaAssetId)

  try {
    const bytes = await stepReadOriginalBytes(asset)
    const metadata = await stepGenerateBlurMetadata(bytes)
    await stepPersistBlurMetadata(input.mediaAssetId, metadata)

    const textResult = await stepGenerateLocalizedText({
      bytes,
      mimeType: asset.mimeType,
      sourceName: asset.originalFilename ?? asset.id,
    })

    if (textResult.status === "generated") {
      await stepPersistGeneratedLocales(input.mediaAssetId, textResult.values)
    } else {
      await stepMarkLocalesSkipped(input.mediaAssetId, textResult)
    }

    await stepMarkComplete(input.mediaAssetId)

    return {
      mediaAssetId: input.mediaAssetId,
      blurUpdated: true,
      localeCount: TOP_GLOBAL_IMAGE_LOCALES.length,
      textStatus: textResult.status,
    }
  } catch (error) {
    await stepMarkFailed(input.mediaAssetId, error)
    throw error
  }
}

async function stepMarkProcessing(mediaAssetId: string) {
  "use step"

  await new MediaAssetService(prisma).updateImageEnrichmentState({
    mediaAssetId,
    user: SYSTEM_PRINCIPAL,
    data: {
      imageEnrichmentStatus: "PROCESSING",
      imageEnrichmentStartedAt: new Date(),
      imageEnrichmentCompletedAt: null,
      imageEnrichmentErrorCode: null,
      imageEnrichmentErrorMessage: null,
    },
  })
}

async function stepLoadAsset(mediaAssetId: string): Promise<EnrichmentAsset> {
  "use step"

  const asset = await prisma.mediaAsset.findUniqueOrThrow({
    where: { id: mediaAssetId },
    select: {
      id: true,
      kind: true,
      backend: true,
      objectKey: true,
      mimeType: true,
      originalFilename: true,
    },
  })

  if (asset.kind !== "IMAGE") {
    throw new Error("Image enrichment requires an image asset")
  }
  if (!asset.objectKey) {
    throw new Error("Image enrichment requires stored original bytes")
  }

  return asset
}

async function stepSeedLocales(mediaAssetId: string) {
  "use step"

  await new MediaAssetService(prisma).seedTopImageLocales({
    mediaAssetId,
    user: SYSTEM_PRINCIPAL,
  })
}

async function stepReadOriginalBytes(asset: EnrichmentAsset) {
  "use step"

  if (!asset.objectKey) {
    throw new Error("Image enrichment requires stored original bytes")
  }

  return readMediaObject({
    key: asset.objectKey,
    backend: asset.backend,
  })
}

async function stepGenerateBlurMetadata(bytes: Uint8Array) {
  "use step"

  return generateImageMetadata(bytes)
}

async function stepPersistBlurMetadata(
  mediaAssetId: string,
  metadata: Awaited<ReturnType<typeof generateImageMetadata>>,
) {
  "use step"

  await new MediaAssetService(prisma).updateImageEnrichmentState({
    mediaAssetId,
    user: SYSTEM_PRINCIPAL,
    data: {
      blurDataUrl: metadata.blurDataUrl,
      dominantColor: metadata.dominantColor,
      width: metadata.width,
      height: metadata.height,
    },
  })
}

async function stepGenerateLocalizedText(input: {
  bytes: Uint8Array
  mimeType: string
  sourceName: string
}) {
  "use step"

  return generateLocalizedImageText({
    imageDataUrl: bytesToDataUrl(input.bytes, input.mimeType),
    sourceName: input.sourceName,
  })
}

async function stepPersistGeneratedLocales(
  mediaAssetId: string,
  values: Array<{ locale: string; displayName: string; altText: string }>,
) {
  "use step"

  const service = new MediaAssetService(prisma)
  await Promise.all(
    values.map((value) =>
      service.upsertAiImageLocale({
        input: {
          mediaAssetId,
          locale: value.locale,
          displayName: value.displayName,
          altText: value.altText,
          status: "COMPLETE",
        },
        user: SYSTEM_PRINCIPAL,
      }),
    ),
  )
}

async function stepMarkLocalesSkipped(
  mediaAssetId: string,
  textResult: {
    reason: "missing_provider" | "provider_rate_limited"
    message?: string
  },
) {
  "use step"

  const errorCode =
    textResult.reason === "provider_rate_limited"
      ? "provider_rate_limited"
      : "missing_provider"
  const errorMessage =
    textResult.reason === "provider_rate_limited"
      ? "Image text generation provider is temporarily rate-limited."
      : "Image text generation provider is not configured."

  const service = new MediaAssetService(prisma)
  await Promise.all(
    TOP_GLOBAL_IMAGE_LOCALES.map((locale) =>
      service.upsertAiImageLocale({
        input: {
          mediaAssetId,
          locale,
          status: "SKIPPED",
          errorCode,
          errorMessage: textResult.message ?? errorMessage,
        },
        user: SYSTEM_PRINCIPAL,
      }),
    ),
  )
}

async function stepMarkComplete(mediaAssetId: string) {
  "use step"

  await new MediaAssetService(prisma).updateImageEnrichmentState({
    mediaAssetId,
    user: SYSTEM_PRINCIPAL,
    data: {
      imageEnrichmentStatus: "COMPLETE",
      imageEnrichmentCompletedAt: new Date(),
      imageEnrichmentErrorCode: null,
      imageEnrichmentErrorMessage: null,
    },
  })
}

async function stepMarkFailed(mediaAssetId: string, error: unknown) {
  "use step"

  await new MediaAssetService(prisma).updateImageEnrichmentState({
    mediaAssetId,
    user: SYSTEM_PRINCIPAL,
    data: {
      imageEnrichmentStatus: "FAILED",
      imageEnrichmentCompletedAt: new Date(),
      imageEnrichmentErrorCode: "image_enrichment_failed",
      imageEnrichmentErrorMessage:
        error instanceof Error ? error.message : String(error),
    },
  })
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`
}
