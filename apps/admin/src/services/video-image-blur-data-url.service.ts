import { after } from "next/server"
import type { PrismaClient } from "@prisma/client"
import { generateDominantColorStrict } from "./image-metadata.service"

const FETCH_TIMEOUT_MS = 3000
const MAX_BLUR_BYTES = 64 * 1024
const VIDEO_IMAGE_BLUR_WIDTH = 24
const VIDEO_IMAGE_BLUR_HEIGHT = 14
const PRIVATE_IPV4_PATTERN =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/

const pendingGenerations = new Map<string, Promise<void>>()

type FetchedImageMetadata = {
  dataUrl: string
  dominantColor: string
}

export async function getOrScheduleVideoImageBlurDataUrl({
  imageId,
  imageUrl,
  prisma,
}: {
  imageId: string
  imageUrl: string
  prisma: PrismaClient
}): Promise<string | null> {
  const existing = await prisma.videoImage.findUnique({
    where: { id: imageId },
    select: { blurDataUrl: true, dominantColor: true },
  })
  if (existing?.blurDataUrl) {
    if (!existing.dominantColor) {
      scheduleVideoImageBlurDataUrlGeneration({ imageId, imageUrl, prisma })
    }
    return existing.blurDataUrl
  }

  scheduleVideoImageBlurDataUrlGeneration({ imageId, imageUrl, prisma })
  return null
}

export async function getOrCreateVideoImageBlurDataUrl({
  imageId,
  imageUrl,
  prisma,
}: {
  imageId: string
  imageUrl: string
  prisma: PrismaClient
}): Promise<string | null> {
  const existing = await prisma.videoImage.findUnique({
    where: { id: imageId },
    select: { blurDataUrl: true, dominantColor: true },
  })
  if (existing?.blurDataUrl && existing.dominantColor) {
    return existing.blurDataUrl
  }

  return generateAndStoreVideoImageBlurDataUrl({ imageId, imageUrl, prisma })
}

function scheduleVideoImageBlurDataUrlGeneration({
  imageId,
  imageUrl,
  prisma,
}: {
  imageId: string
  imageUrl: string
  prisma: PrismaClient
}): void {
  const existing = pendingGenerations.get(imageId)
  if (existing) return

  const generation = generateAndStoreVideoImageBlurDataUrl({
    imageId,
    imageUrl,
    prisma,
  })
    .then(() => undefined)
    .finally(() => {
      pendingGenerations.delete(imageId)
    })
  pendingGenerations.set(imageId, generation)

  try {
    after(() => generation)
  } catch {
    void generation
  }
}

async function generateAndStoreVideoImageBlurDataUrl({
  imageId,
  imageUrl,
  prisma,
}: {
  imageId: string
  imageUrl: string
  prisma: PrismaClient
}): Promise<string | null> {
  const blurUrl = buildVideoImageBlurUrl(imageUrl)
  const metadata = await fetchImageMetadata(blurUrl, imageId)
  if (!metadata) return null

  await prisma.videoImage.update({
    where: { id: imageId },
    data: {
      blurDataUrl: metadata.dataUrl,
      dominantColor: metadata.dominantColor,
    },
  })
  return metadata.dataUrl
}

export function buildVideoImageBlurUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl)
    const segments = url.pathname.split("/")
    const variantIndex = segments.findIndex((segment) =>
      segment.split(",").some((part) => /^w=\d+$/.test(part)),
    )
    if (variantIndex === -1) return imageUrl

    const parts = segments[variantIndex]!.split(",")
    const nextParts = parts.map((part) => {
      if (/^w=\d+$/.test(part)) return `w=${VIDEO_IMAGE_BLUR_WIDTH}`
      if (/^h=\d+$/.test(part)) return `h=${VIDEO_IMAGE_BLUR_HEIGHT}`
      if (/^q=\d+$/.test(part)) return "q=40"
      return part
    })
    if (!nextParts.some((part) => /^w=\d+$/.test(part))) {
      nextParts.push(`w=${VIDEO_IMAGE_BLUR_WIDTH}`)
    }
    if (!nextParts.some((part) => /^h=\d+$/.test(part))) {
      nextParts.push(`h=${VIDEO_IMAGE_BLUR_HEIGHT}`)
    }
    if (!nextParts.some((part) => /^q=\d+$/.test(part))) {
      nextParts.push("q=40")
    }
    segments[variantIndex] = nextParts.join(",")
    url.pathname = segments.join("/")
    return url.toString()
  } catch {
    return imageUrl
  }
}

async function fetchImageMetadata(
  url: string,
  imageId: string,
): Promise<FetchedImageMetadata | null> {
  if (!isPublicHttpsImageUrl(url)) {
    logVideoImageBlurGenerationSkipped({
      imageId,
      url,
      reason: "blocked_url",
    })
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
    })
    if (!response.ok) {
      logVideoImageBlurGenerationSkipped({
        imageId,
        url,
        reason: "http_status",
        status: response.status,
      })
      return null
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg"
    if (!contentType.toLowerCase().startsWith("image/")) {
      logVideoImageBlurGenerationSkipped({
        imageId,
        url,
        reason: "non_image_content_type",
        contentType,
      })
      return null
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0)
    if (contentLength > MAX_BLUR_BYTES) {
      logVideoImageBlurGenerationSkipped({
        imageId,
        url,
        reason: "content_length_exceeded",
        bytes: contentLength,
      })
      return null
    }

    const buffer = await readCappedResponseBytes(response, MAX_BLUR_BYTES)
    if (!buffer) {
      logVideoImageBlurGenerationSkipped({
        imageId,
        url,
        reason: "body_size_invalid",
      })
      return null
    }

    return {
      dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
      dominantColor: await generateDominantColorStrict(buffer),
    }
  } catch (error) {
    logVideoImageBlurGenerationSkipped({
      imageId,
      url,
      reason: "fetch_or_decode_failed",
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function logVideoImageBlurGenerationSkipped(details: {
  imageId: string
  url: string
  reason: string
  status?: number
  contentType?: string
  bytes?: number
  error?: string
}) {
  console.info(
    JSON.stringify({
      event: "video-image.blur-data-url.generation.skipped",
      ...details,
    }),
  )
}

async function readCappedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  if (totalBytes === 0) return null
  return Buffer.concat(chunks, totalBytes)
}

export function isPublicHttpsImageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") return false

    const hostname = url.hostname.toLowerCase()
    if (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".local") ||
      PRIVATE_IPV4_PATTERN.test(hostname)
    ) {
      return false
    }

    return true
  } catch {
    return false
  }
}
