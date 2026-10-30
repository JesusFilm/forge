import { z } from "zod"
import { videoLibraryThumbnail } from "./studio-library-thumbnail"

const videoCache = new Map<
  string,
  Awaited<ReturnType<typeof videoLibraryThumbnail>>
>()
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import {
  createStudioAssetBroker,
  type StudioBrokerClient,
} from "./studio-broker"

/** Authorize each request before reading bounded, digest-verified retained bytes. */
export async function libraryImage(
  call: StudioBrokerClient,
  raw: unknown,
  signal?: AbortSignal,
) {
  const reference = studioAssetReferenceSchema.parse(raw)
  const asset = studioAssetVersionSchema.parse(await call("asset", reference))
  const type = z
    .enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/mp2t",
    ])
    .parse(asset.mimeType)
  if (asset.byteSize > 16 * 1024 * 1024)
    throw new Error("Media exceeds preview limit")
  const video = type.startsWith("video/")
  const cached = video ? videoCache.get(reference.digest) : undefined
  if (cached) return { type: "image/jpeg", ...cached }
  const bytes = await createStudioAssetBroker(call, signal).read(
    reference,
    16 * 1024 * 1024,
  )
  if (!video) return { type, bytes, durationMs: undefined }
  const thumbnail = await videoLibraryThumbnail(bytes, signal)
  if (videoCache.size >= 32) videoCache.delete(videoCache.keys().next().value!)
  videoCache.set(reference.digest, thumbnail)
  return { type: "image/jpeg", ...thumbnail }
}
