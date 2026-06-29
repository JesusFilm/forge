import { createHash } from "node:crypto"
import { after } from "next/server"
import type { PrismaClient } from "@prisma/client"

const FETCH_TIMEOUT_MS = 3000
const MAX_LQIP_BYTES = 64 * 1024
const BACKGROUND_GENERATION_CONCURRENCY = 4

export const WATCH_CHAPTER_CAROUSEL_MUX_IMAGE_PURPOSE = "watch-chapter-carousel"
export const WATCH_HERO_POSTER_MUX_IMAGE_PURPOSE = "watch-hero-poster"

type MuxImagePurpose =
  | typeof WATCH_CHAPTER_CAROUSEL_MUX_IMAGE_PURPOSE
  | typeof WATCH_HERO_POSTER_MUX_IMAGE_PURPOSE

type MuxImageRecipe = {
  purpose: MuxImagePurpose
  source: {
    width: number
    height?: number
    fitMode?: "smartcrop"
    time: number
    format: "jpg" | "webp"
  }
  lqip: {
    width: number
    height?: number
    fitMode?: "smartcrop"
    time: number
    format: "jpg" | "webp"
  }
}

const WATCH_CHAPTER_CAROUSEL_RECIPE = {
  purpose: WATCH_CHAPTER_CAROUSEL_MUX_IMAGE_PURPOSE,
  source: {
    width: 448,
    height: 252,
    fitMode: "smartcrop",
    time: 2,
    format: "jpg",
  },
  lqip: {
    width: 24,
    height: 14,
    fitMode: "smartcrop",
    time: 2,
    format: "jpg",
  },
} satisfies MuxImageRecipe

const WATCH_HERO_POSTER_RECIPE = {
  purpose: WATCH_HERO_POSTER_MUX_IMAGE_PURPOSE,
  source: {
    width: 1280,
    time: 2,
    format: "webp",
  },
  lqip: {
    width: 32,
    time: 2,
    format: "webp",
  },
} satisfies MuxImageRecipe

const pendingBackgroundGenerations = new Map<string, Promise<void>>()
const backgroundGenerationQueue: Array<() => void> = []
let activeBackgroundGenerations = 0

export function muxImageDerivativeParamsHash(recipe: MuxImageRecipe): string {
  return createHash("sha256")
    .update(JSON.stringify(recipe))
    .digest("hex")
    .slice(0, 32)
}

export function buildWatchChapterCarouselMuxThumbnailUrl(
  playbackId: string,
): string {
  return buildMuxThumbnailUrl(playbackId, WATCH_CHAPTER_CAROUSEL_RECIPE.source)
}

export function buildWatchChapterCarouselMuxLqipUrl(
  playbackId: string,
): string {
  return buildMuxThumbnailUrl(playbackId, WATCH_CHAPTER_CAROUSEL_RECIPE.lqip)
}

export function buildWatchHeroPosterMuxThumbnailUrl(
  playbackId: string,
): string {
  return buildMuxThumbnailUrl(playbackId, WATCH_HERO_POSTER_RECIPE.source)
}

export function buildWatchHeroPosterMuxLqipUrl(playbackId: string): string {
  return buildMuxThumbnailUrl(playbackId, WATCH_HERO_POSTER_RECIPE.lqip)
}

export async function getOrCreateWatchChapterCarouselMuxBlurDataUrl({
  prisma,
  muxVideoId,
  playbackId,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
}): Promise<string | null> {
  return getOrCreateMuxBlurDataUrl({
    prisma,
    muxVideoId,
    playbackId,
    recipe: WATCH_CHAPTER_CAROUSEL_RECIPE,
  })
}

export async function getOrScheduleWatchChapterCarouselMuxBlurDataUrl({
  prisma,
  muxVideoId,
  playbackId,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
}): Promise<string | null> {
  return getOrScheduleMuxBlurDataUrl({
    prisma,
    muxVideoId,
    playbackId,
    recipe: WATCH_CHAPTER_CAROUSEL_RECIPE,
  })
}

export async function getOrCreateWatchHeroPosterMuxBlurDataUrl({
  prisma,
  muxVideoId,
  playbackId,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
}): Promise<string | null> {
  return getOrCreateMuxBlurDataUrl({
    prisma,
    muxVideoId,
    playbackId,
    recipe: WATCH_HERO_POSTER_RECIPE,
  })
}

export async function getOrScheduleWatchHeroPosterMuxBlurDataUrl({
  prisma,
  muxVideoId,
  playbackId,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
}): Promise<string | null> {
  return getOrScheduleMuxBlurDataUrl({
    prisma,
    muxVideoId,
    playbackId,
    recipe: WATCH_HERO_POSTER_RECIPE,
  })
}

async function getOrScheduleMuxBlurDataUrl({
  prisma,
  muxVideoId,
  playbackId,
  recipe,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
  recipe: MuxImageRecipe
}): Promise<string | null> {
  const existing = await getStoredMuxBlurDataUrl({ prisma, muxVideoId, recipe })
  if (existing) return existing

  scheduleMuxBlurDataUrlGeneration({ prisma, muxVideoId, playbackId, recipe })
  return null
}

async function getOrCreateMuxBlurDataUrl({
  prisma,
  muxVideoId,
  playbackId,
  recipe,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
  recipe: MuxImageRecipe
}): Promise<string | null> {
  const existing = await getStoredMuxBlurDataUrl({ prisma, muxVideoId, recipe })
  if (existing) return existing

  const paramsHash = muxImageDerivativeParamsHash(recipe)
  const sourceUrl = buildMuxThumbnailUrl(playbackId, recipe.source)
  const lqipUrl = buildMuxThumbnailUrl(playbackId, recipe.lqip)
  const blurDataUrl = await fetchImageAsDataUrl(lqipUrl)
  if (!blurDataUrl) return null

  const row = await prisma.muxImageDerivative.upsert({
    where: {
      muxVideoId_purpose_paramsHash: {
        muxVideoId,
        purpose: recipe.purpose,
        paramsHash,
      },
    },
    create: {
      muxVideoId,
      purpose: recipe.purpose,
      paramsHash,
      params: recipe,
      sourceUrl,
      lqipUrl,
      blurDataUrl,
    },
    update: {
      sourceUrl,
      lqipUrl,
      blurDataUrl,
      generatedAt: new Date(),
    },
    select: { blurDataUrl: true },
  })

  return row.blurDataUrl
}

async function getStoredMuxBlurDataUrl({
  prisma,
  muxVideoId,
  recipe,
}: {
  prisma: PrismaClient
  muxVideoId: string
  recipe: MuxImageRecipe
}): Promise<string | null> {
  const paramsHash = muxImageDerivativeParamsHash(recipe)
  const existing = await prisma.muxImageDerivative.findUnique({
    where: {
      muxVideoId_purpose_paramsHash: {
        muxVideoId,
        purpose: recipe.purpose,
        paramsHash,
      },
    },
    select: { blurDataUrl: true },
  })
  return existing?.blurDataUrl ?? null
}

function scheduleMuxBlurDataUrlGeneration({
  prisma,
  muxVideoId,
  playbackId,
  recipe,
}: {
  prisma: PrismaClient
  muxVideoId: string
  playbackId: string
  recipe: MuxImageRecipe
}): void {
  const generation = enqueueMuxBlurDataUrlGeneration({
    key: `${muxVideoId}:${recipe.purpose}:${muxImageDerivativeParamsHash(recipe)}`,
    run: () =>
      getOrCreateMuxBlurDataUrl({ prisma, muxVideoId, playbackId, recipe }),
  })

  try {
    after(() => generation)
  } catch {
    void generation
  }
}

function enqueueMuxBlurDataUrlGeneration({
  key,
  run,
}: {
  key: string
  run: () => Promise<string | null>
}): Promise<void> {
  const pending = pendingBackgroundGenerations.get(key)
  if (pending) return pending

  const generation = new Promise<void>((resolve) => {
    backgroundGenerationQueue.push(() => {
      activeBackgroundGenerations += 1
      void run()
        .catch((error) => {
          console.warn("[mux-image-derivative] background generation failed", {
            key,
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          activeBackgroundGenerations -= 1
          pendingBackgroundGenerations.delete(key)
          resolve()
          drainBackgroundGenerationQueue()
        })
    })
    drainBackgroundGenerationQueue()
  })

  pendingBackgroundGenerations.set(key, generation)
  return generation
}

function drainBackgroundGenerationQueue(): void {
  while (
    activeBackgroundGenerations < BACKGROUND_GENERATION_CONCURRENCY &&
    backgroundGenerationQueue.length > 0
  ) {
    backgroundGenerationQueue.shift()?.()
  }
}

function buildMuxThumbnailUrl(
  playbackId: string,
  params: MuxImageRecipe["source"],
): string {
  const url = new URL(
    `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.${params.format}`,
  )
  url.searchParams.set("width", String(params.width))
  if (params.height != null)
    url.searchParams.set("height", String(params.height))
  if (params.fitMode != null) url.searchParams.set("fit_mode", params.fitMode)
  url.searchParams.set("time", String(params.time))
  return url.toString()
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
    })
    if (!response.ok) return null

    const contentType = response.headers.get("content-type") ?? "image/jpeg"
    if (!contentType.startsWith("image/")) return null

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LQIP_BYTES) {
      return null
    }

    return `data:${contentType};base64,${bytes.toString("base64")}`
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
