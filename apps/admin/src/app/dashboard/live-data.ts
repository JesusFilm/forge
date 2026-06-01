import type { LocaleStatus, VideoDub } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import { prisma } from "@/db/client"
import {
  BlocksSchema,
  type Block,
  type ContainerContentBlock,
  type SectionContentBlock,
} from "@/domain/blocks"
import { getAdminLocale } from "@/i18n/server"
import { createServices } from "@/services"
import { env } from "@/config/env"
import { WatchRouteManifestStore } from "@/services/watch-route-manifest-store"
import {
  createVideoLibraryPagination,
  normalizeVideoThumbnailUrl,
  resolveVideoVisitorUrl,
  VIDEO_LIBRARY_PAGE_SIZE,
} from "./video-library-utils"

function isMissingTableError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2021"
  )
}

type ExperienceLocaleRow = {
  experienceId: string
  locale: string
  slug: string
  pathSegment: string | null
  title: string | null
  ogImageUrl: string | null
  blocks: unknown
  status: LocaleStatus
  updatedAt: Date
}

type VideoLocaleRow = {
  videoId: string
  locale: string
  title: string | null
  description: string | null
  updatedAt: Date
}

type VideoDubRow = VideoDub & {
  language: {
    bcp47: string | null
    iso3: string | null
    slug: string | null
  } | null
}

type VideoImageRow = {
  videoId: string
  url: string | null
  kind: string | null
  createdAt: Date
}

type LoadVideoRowSliceOptions = {
  principal: Principal
  limit: number
  offset: number
  includeVisitorUrls?: boolean
}

function durationSecondsForDub(
  dub: Pick<VideoDubRow, "lengthInMilliseconds" | "duration">,
) {
  if (dub.lengthInMilliseconds != null) {
    return Number(dub.lengthInMilliseconds / BigInt(1000))
  }
  return dub.duration ?? null
}

function preferredPlaybackDub(dubs: VideoDubRow[]) {
  return dubs.find((dub) => dub.hls)?.hls
    ? (dubs.find((dub) => dub.hls) ?? null)
    : (dubs.find((dub) => dub.dash || dub.share) ?? null)
}

function preferredLocaleCodes(locale: string) {
  const base = locale.split("-")[0]
  return base && base !== locale ? [locale, base] : [locale]
}

function choosePreferredLocale<T extends { locale: string }>(
  locales: readonly T[],
  preferred: string,
) {
  const priority = preferredLocaleCodes(preferred)
  for (const code of priority) {
    const exact = locales.find((item) => item.locale === code)
    if (exact) return exact
  }

  for (const code of priority) {
    const partial = locales.find((item) => item.locale.startsWith(code))
    if (partial) return partial
  }

  return locales[0]
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value)
}

function statusTone(status: LocaleStatus): "success" | "warning" | "danger" {
  if (status === "PUBLISHED") return "success"
  if (status === "ARCHIVED") return "danger"
  return "warning"
}

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null
}

function directUrl(value: object, fields: readonly string[]): string | null {
  for (const field of fields) {
    if (field in value) {
      const fieldValue = (value as Record<string, unknown>)[field]
      if (typeof fieldValue === "string" && fieldValue.trim()) {
        return fieldValue.trim()
      }
    }
  }
  return null
}

type PreviewBlock = Block | SectionContentBlock | ContainerContentBlock

function addVideoId(ids: Set<string>, value: string | null | undefined) {
  const id = compactText(value)
  if (id) ids.add(id)
}

function collectVideoIdsFromBlock(block: PreviewBlock, ids: Set<string>) {
  if (block.t === "video" || block.t === "videoHero") {
    addVideoId(ids, block.videoId)
  }

  if (block.t === "mediaCollection" || block.t === "videoCarousel") {
    for (const item of block.items) {
      addVideoId(ids, item.videoId)
    }
  }

  if (block.t === "section") {
    for (const item of block.content) {
      collectVideoIdsFromBlock(item, ids)
    }
  }

  if (block.t === "container") {
    for (const item of block.content) {
      collectVideoIdsFromBlock(item, ids)
    }
  }
}

function videoIdsFromBlocks(blocks: readonly Block[]) {
  const ids = new Set<string>()
  for (const block of blocks) {
    collectVideoIdsFromBlock(block, ids)
  }
  return Array.from(ids)
}

function parsedExperienceBlocks(locale: Pick<ExperienceLocaleRow, "blocks">) {
  const parsed = BlocksSchema.safeParse(locale.blocks)
  return parsed.success ? parsed.data : []
}

function previewImageForVideo(
  videoId: string | null | undefined,
  videoImagesByVideoId: Map<string, VideoImageRow[]>,
) {
  const id = compactText(videoId)
  return id ? preferredVideoImage(videoImagesByVideoId.get(id) ?? []) : null
}

function previewImageFromBlock(
  block: PreviewBlock,
  videoImagesByVideoId: Map<string, VideoImageRow[]>,
): string | null {
  const direct = directUrl(block, [
    "imageUrl",
    "backgroundImageUrl",
    "mediaUrl",
  ])
  if (direct) return direct

  if (block.t === "video" || block.t === "videoHero") {
    return previewImageForVideo(block.videoId, videoImagesByVideoId)
  }

  if (block.t === "mediaCollection") {
    for (const item of block.items) {
      const itemImage =
        item.imageOverrideUrl ??
        item.imageUrl ??
        previewImageForVideo(item.videoId, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  if (block.t === "videoCarousel") {
    for (const item of block.items) {
      const itemImage =
        item.imageOverrideUrl ??
        item.imageUrl ??
        previewImageForVideo(item.videoId, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  if (block.t === "navigationCarousel") {
    for (const item of block.items) {
      if (item.imageUrl) return item.imageUrl
    }
  }

  if (block.t === "bibleQuotesCarousel") {
    for (const quote of block.quotes) {
      const quoteImage = quote.backgroundImageUrl ?? quote.imageUrl
      if (quoteImage) return quoteImage
    }
  }

  if (block.t === "section") {
    for (const item of block.content) {
      const itemImage = previewImageFromBlock(item, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  if (block.t === "container") {
    for (const item of block.content) {
      const itemImage = previewImageFromBlock(item, videoImagesByVideoId)
      if (itemImage) return itemImage
    }
  }

  return null
}

function previewForExperienceLocale(
  locale: ExperienceLocaleRow,
  videoImagesByVideoId: Map<string, VideoImageRow[]>,
) {
  const blocks = parsedExperienceBlocks(locale)
  const imageUrl =
    compactText(locale.ogImageUrl) ??
    blocks
      .map((block) => previewImageFromBlock(block, videoImagesByVideoId))
      .find((url): url is string => !!url) ??
    null

  return {
    imageUrl,
  }
}

function normalizePathPart(value: string | null | undefined) {
  return value?.trim().replace(/^\/+|\/+$/g, "") ?? ""
}

function experiencePath(
  locale: Pick<ExperienceLocaleRow, "pathSegment" | "slug">,
) {
  const parts = [
    normalizePathPart(locale.pathSegment),
    normalizePathPart(locale.slug),
  ].filter(Boolean)

  return `/${parts.join("/")}`
}

function sourceLabel(
  videoSource: "INTERNAL" | "YOUTUBE" | "CLOUDFLARE" | "MUX" | null,
) {
  if (videoSource === "MUX") return { label: "Mux", tone: "info" as const }
  if (videoSource === "CLOUDFLARE") {
    return { label: "Cloudflare", tone: "success" as const }
  }
  if (videoSource === "YOUTUBE") {
    return { label: "YouTube", tone: "warning" as const }
  }
  return { label: "Internal", tone: "muted" as const }
}

function localizedVideoLabel(
  label:
    | "COLLECTION"
    | "EPISODE"
    | "FEATURE_FILM"
    | "SEGMENT"
    | "SERIES"
    | "SHORT_FILM"
    | "TRAILER"
    | "BEHIND_THE_SCENES"
    | null,
  locale: string,
) {
  if (!label) return null
  const isSpanish = locale.startsWith("es")
  const labels = isSpanish
    ? {
        COLLECTION: "Coleccion",
        EPISODE: "Episodio",
        FEATURE_FILM: "Largometraje",
        SEGMENT: "Segmento",
        SERIES: "Serie",
        SHORT_FILM: "Cortometraje",
        TRAILER: "Tráiler",
        BEHIND_THE_SCENES: "Detrás de cámaras",
      }
    : {
        COLLECTION: "Collection",
        EPISODE: "Episode",
        FEATURE_FILM: "Feature Film",
        SEGMENT: "Segment",
        SERIES: "Series",
        SHORT_FILM: "Short Film",
        TRAILER: "Trailer",
        BEHIND_THE_SCENES: "Behind the Scenes",
      }

  return labels[label]
}

function formatDuration(dubs: VideoDubRow[]): string {
  const dub =
    dubs.find((item) => item.lengthInMilliseconds || item.duration) ?? null
  if (!dub) return "--:--"

  const seconds = durationSecondsForDub(dub) ?? 0

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function dubCoverage(dubs: VideoDubRow[]): string {
  if (dubs.length === 0) return "No dubs"

  const allTags = Array.from(
    new Set(
      dubs.map(
        (dub) =>
          dub.language?.bcp47 ?? dub.language?.iso3 ?? dub.language?.slug,
      ),
    ),
  )
    .filter((tag): tag is string => !!tag)
    .map((tag) => tag.toUpperCase())
  const tags = allTags.slice(0, 4)

  const count = dubs.length
  const label = count === 1 ? "1 dub" : `${count} dubs`
  if (tags.length === 0) return label

  const suffix = allTags.length > tags.length ? ", ..." : ""
  return `${label} · ${tags.join(", ")}${suffix}`
}

function preferredVideoImage(images: VideoImageRow[]) {
  if (images.length === 0) return null

  const priority = ["videoStill", "mobileCinematicHigh", "poster", "still"]
  for (const kind of priority) {
    const match = images.find((image) => image.kind === kind && image.url)
    if (match?.url) return normalizeVideoThumbnailUrl(match.url)
  }

  return normalizeVideoThumbnailUrl(images.find((image) => image.url)?.url)
}

async function countActiveVideos() {
  const services = createServices(prisma)
  try {
    return await services.video.countActive()
  } catch (error) {
    if (isMissingTableError(error)) {
      return 0
    }
    throw error
  }
}

async function loadLatestWatchRouteManifest() {
  try {
    return (
      (await new WatchRouteManifestStore(prisma).getLatest())?.payload ?? null
    )
  } catch (error) {
    if (isMissingTableError(error)) {
      return null
    }
    throw error
  }
}

export async function loadExperienceRows(principal: Principal) {
  const services = createServices(prisma)
  const locale = await getAdminLocale()
  let experiences: Awaited<ReturnType<typeof services.experience.list>>
  try {
    experiences = await services.experience.list({
      input: { limit: 50, offset: 0, includeArchived: false },
      user: principal,
      query: {},
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const ids = experiences.map((item) => item.id)
  let locales: ExperienceLocaleRow[] = []
  try {
    locales = await prisma.experienceLocale.findMany({
      where: { experienceId: { in: ids } },
      select: {
        experienceId: true,
        locale: true,
        slug: true,
        pathSegment: true,
        title: true,
        ogImageUrl: true,
        blocks: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const localesByExperience = new Map<string, typeof locales>()
  for (const item of locales) {
    const current = localesByExperience.get(item.experienceId) ?? []
    current.push(item)
    localesByExperience.set(item.experienceId, current)
  }

  const videoIds = Array.from(
    new Set(
      locales.flatMap((item) =>
        videoIdsFromBlocks(parsedExperienceBlocks(item)),
      ),
    ),
  )
  let videoImages: VideoImageRow[] = []
  if (videoIds.length > 0) {
    try {
      videoImages = await prisma.videoImage.findMany({
        where: { videoId: { in: videoIds } },
        select: {
          videoId: true,
          url: true,
          kind: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    } catch (error) {
      if (isMissingTableError(error)) {
        videoImages = []
      } else {
        throw error
      }
    }
  }

  const videoImagesByVideoId = new Map<string, VideoImageRow[]>()
  for (const item of videoImages) {
    const current = videoImagesByVideoId.get(item.videoId) ?? []
    current.push(item)
    videoImagesByVideoId.set(item.videoId, current)
  }

  return experiences.map((experience) => {
    const experienceLocales = localesByExperience.get(experience.id) ?? []
    const localeRow = choosePreferredLocale(experienceLocales, locale)
    const title = localeRow?.title?.trim() || "Untitled Experience"
    const path = localeRow
      ? experiencePath(localeRow)
      : `/${normalizePathPart(experience.id)}`
    const status = localeRow?.status ?? "DRAFT"
    const preview = localeRow
      ? previewForExperienceLocale(localeRow, videoImagesByVideoId)
      : {
          imageUrl: null,
        }

    return {
      key: experience.id,
      locale: localeRow?.locale ?? locale,
      title,
      slug: path,
      statusLabel: status,
      statusTone: statusTone(status),
      preview,
    }
  })
}

async function loadVideoRowSlice({
  principal,
  limit,
  offset,
  includeVisitorUrls = false,
}: LoadVideoRowSliceOptions) {
  const services = createServices(prisma)
  const locale = await getAdminLocale()
  let videos: Awaited<ReturnType<typeof services.video.list>>
  try {
    // U2: VideoService.list dropped its `user` param. Route is gated by requireSession().
    void principal
    videos = await services.video.list({
      input: { limit, offset },
      query: {},
    })
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const ids = videos.map((item) => item.id)
  let videoLocales: VideoLocaleRow[] = []
  let videoDubs: VideoDubRow[] = []
  let videoImages: VideoImageRow[] = []
  try {
    ;[videoLocales, videoDubs, videoImages] = await Promise.all([
      prisma.videoLocale.findMany({
        where: { videoId: { in: ids } },
        select: {
          videoId: true,
          locale: true,
          title: true,
          description: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.videoDub.findMany({
        where: { videoId: { in: ids }, deletedAt: null },
        include: {
          language: {
            select: {
              bcp47: true,
              iso3: true,
              slug: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.videoImage.findMany({
        where: { videoId: { in: ids } },
        select: {
          videoId: true,
          url: true,
          kind: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ])
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }

  const localesByVideo = new Map<string, typeof videoLocales>()
  for (const item of videoLocales) {
    const current = localesByVideo.get(item.videoId) ?? []
    current.push(item)
    localesByVideo.set(item.videoId, current)
  }

  const dubsByVideo = new Map<string, VideoDubRow[]>()
  for (const item of videoDubs) {
    const current = dubsByVideo.get(item.videoId) ?? []
    current.push(item)
    dubsByVideo.set(item.videoId, current)
  }

  const imagesByVideo = new Map<string, VideoImageRow[]>()
  for (const item of videoImages) {
    const current = imagesByVideo.get(item.videoId) ?? []
    current.push(item)
    imagesByVideo.set(item.videoId, current)
  }

  const routeManifest = includeVisitorUrls
    ? await loadLatestWatchRouteManifest()
    : null

  return videos.map((video) => {
    const localeRows = localesByVideo.get(video.id) ?? []
    const dubRows = dubsByVideo.get(video.id) ?? []
    const imageRows = imagesByVideo.get(video.id) ?? []
    const localeRow = choosePreferredLocale(localeRows, locale)
    const title = localeRow?.title?.trim() || video.slug
    const source = sourceLabel(video.videoSource)
    const playbackDub = preferredPlaybackDub(dubRows)

    return {
      key: video.id,
      title,
      description: localeRow?.description?.trim() || null,
      id: video.coreId,
      slug: video.slug,
      label: video.label ?? null,
      labelLabel: localizedVideoLabel(video.label ?? null, locale),
      sourceLabel: source.label,
      sourceTone: source.tone,
      dubs: dubCoverage(dubRows),
      updated: formatDateTime(video.updatedAt),
      duration: formatDuration(dubRows),
      durationSeconds: playbackDub ? durationSecondsForDub(playbackDub) : null,
      previewImageUrl: preferredVideoImage(imageRows),
      previewStreamUrl:
        playbackDub?.hls ?? playbackDub?.dash ?? playbackDub?.share ?? null,
      visitorUrl: includeVisitorUrls
        ? resolveVideoVisitorUrl({
            contentSlug: video.slug,
            manifest: routeManifest,
            webOrigin: env.WEB_CANONICAL_ORIGIN,
          })
        : null,
    }
  })
}

export async function loadVideoRows(principal: Principal) {
  return loadVideoRowSlice({
    principal,
    limit: VIDEO_LIBRARY_PAGE_SIZE,
    offset: 0,
  })
}

export async function loadVideoLibraryPage(
  principal: Principal,
  {
    page,
    pageSize = VIDEO_LIBRARY_PAGE_SIZE,
  }: { page: number; pageSize?: number },
) {
  const total = await countActiveVideos()
  const pagination = createVideoLibraryPagination({
    total,
    requestedPage: page,
    pageSize,
  })

  const rows =
    total === 0
      ? []
      : await loadVideoRowSlice({
          principal,
          limit: pagination.pageSize,
          offset: pagination.offset,
          includeVisitorUrls: true,
        })

  return { rows, pagination }
}
