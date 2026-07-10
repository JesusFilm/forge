import { Buffer } from "node:buffer"
import { start } from "workflow/api"
import { hasPermission } from "@/auth/permissions"
import { SYSTEM_PRINCIPAL, type Principal } from "@/auth/principal"
import { createServices } from "@/services"
import { ForbiddenError } from "@/services/errors"
import {
  defaultBackend,
  safeMediaFilename,
  writeMediaObject,
} from "@/storage/media"
import { MAX_MEDIA_UPLOAD_BYTES } from "@/app/dashboard/media/media-upload-limits"
import { prisma } from "@/db/client"
import { runMediaImageEnrichment } from "@/workflows/mediaImageEnrichment"

export type UploadMediaAssetActionResult = {
  ok: boolean
  error?:
    | "forbidden"
    | "missing-file"
    | "too-large"
    | "unsupported-file"
    | "unknown"
}

type SupportedMediaKind = "IMAGE" | "VIDEO" | "PDF" | "FILE"

export function mediaKindForMimeType(mimeType: string): SupportedMediaKind {
  if (mimeType.startsWith("image/")) return "IMAGE"
  if (mimeType.startsWith("video/")) return "VIDEO"
  if (mimeType === "application/pdf") return "PDF"
  return "FILE"
}

export function uploadedFile(value: FormDataEntryValue | null) {
  if (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "size" in value &&
    "name" in value &&
    "type" in value
  ) {
    return value as File
  }

  return null
}

export async function uploadMediaAssetFromFormData({
  formData,
  user,
  imageOnly = false,
}: {
  formData: FormData
  user: Principal | null
  imageOnly?: boolean
}): Promise<UploadMediaAssetActionResult> {
  const services = createServices(prisma)
  if (!hasPermission(user, "write:media-assets")) {
    return { ok: false as const, error: "forbidden" as const }
  }

  const file = uploadedFile(formData.get("file"))
  if (!file || file.size === 0) {
    return { ok: false as const, error: "missing-file" as const }
  }
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    return { ok: false as const, error: "too-large" as const }
  }

  const kind = mediaKindForMimeType(file.type)
  if (imageOnly && kind !== "IMAGE") {
    return { ok: false as const, error: "unsupported-file" as const }
  }

  const folderId = String(formData.get("folderId") ?? "").trim()
  const backend = defaultBackend()
  const displayName = file.name

  try {
    const asset = await services.mediaAsset.create({
      input: {
        kind,
        backend,
        status: "UPLOADING",
        visibility: "PUBLIC",
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size.toString(),
        originalFilename: file.name,
        ...(folderId ? { folderId } : {}),
      },
      user,
    })
    await services.mediaAsset.updateImageLocale({
      input: {
        mediaAssetId: asset.id,
        locale: "en",
        displayName,
      },
      user,
    })
    const filename = safeMediaFilename(file.name)
    const key = await writeMediaObject({
      backend,
      assetId: asset.id,
      filename,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || undefined,
    })

    await services.mediaAsset.update({
      input: {
        id: asset.id,
        status: "READY",
        objectKey: key,
        ...(folderId ? { folderId } : {}),
      },
      user,
    })

    if (kind === "IMAGE") {
      try {
        await start(runMediaImageEnrichment, [{ mediaAssetId: asset.id }])
      } catch (error) {
        await services.mediaAsset.updateImageEnrichmentState({
          mediaAssetId: asset.id,
          user: SYSTEM_PRINCIPAL,
          data: {
            imageEnrichmentStatus: "FAILED",
            imageEnrichmentErrorCode: "workflow_dispatch_failed",
            imageEnrichmentErrorMessage:
              error instanceof Error ? error.message : String(error),
            imageEnrichmentCompletedAt: new Date(),
          },
        })
      }
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false as const, error: "forbidden" as const }
    }
    return { ok: false as const, error: "unknown" as const }
  }

  return { ok: true as const }
}
