import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import client from "@/lib/admin-client"
import { tryAsContentSlug, tryAsLocaleSlug, watchVideoPath } from "@/lib/routes"
import { resolvePosterUrl } from "@/lib/url"
import {
  DEFAULT_WATCH_HOME_LANGUAGE_SLUG,
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_MAX_VIDEO_SLIDES,
  WATCH_HOME_MUX_INSERTS,
  WATCH_HOME_PLAYLIST_SEQUENCE,
  type WatchHomeMuxInsertConfig,
} from "@/lib/watch-home-carousel-config"

const WATCH_HOME_VIDEO_FRAGMENT = adminGraphql(`
  fragment WatchHomeCarouselVideo on Video @_unmask {
    documentId: id
    coreId
    slug
    label
    durationSeconds
    images {
      documentId: id
      url
      thumbnail
      mobileCinematicHigh
      mobileCinematicLow
      videoStill
    }
    locales(locale: $locale, languageSlug: $languageSlug) {
      documentId: id
      languageSlug
      title
      snippet
      imageAlt
    }
    fallbackLocales: locales(locale: $locale) {
      documentId: id
      languageSlug
      title
      snippet
      imageAlt
    }
    defaultLocales: locales(locale: "en", languageSlug: "english") {
      documentId: id
      languageSlug
      title
      snippet
      imageAlt
    }
    variants: dubs(language: $languageSlug, playableOnly: true, limit: 1) {
      documentId: id
      slug
      published
      hls
      duration
      language {
        slug
        bcp47
        name
      }
      muxVideo {
        playbackId
      }
    }
  }
`)

const GET_WATCH_HOME_CAROUSEL_VIDEOS = adminGraphql(
  `
    query GetWatchHomeCarouselVideos(
      $locale: String!
      $languageSlug: String!
      $category: VideoListCategory
      $collection: String
      $limit: Int!
      $offset: Int
      $sort: VideoListSort
    ) {
      videos(
        category: $category
        collection: $collection
        language: $languageSlug
        limit: $limit
        offset: $offset
        sort: $sort
      ) {
        ...WatchHomeCarouselVideo
      }
    }
  `,
  [WATCH_HOME_VIDEO_FRAGMENT],
)

type WatchHomeCarouselVideosData = AdminResultOf<
  typeof GET_WATCH_HOME_CAROUSEL_VIDEOS
>
type AdminWatchHomeVideo = NonNullable<
  WatchHomeCarouselVideosData["videos"]
>[number]

type AdminWatchHomeImage = NonNullable<AdminWatchHomeVideo["images"]>[number]
type AdminWatchHomeVariant = NonNullable<
  AdminWatchHomeVideo["variants"]
>[number]
type AdminWatchHomeLocale = NonNullable<AdminWatchHomeVideo["locales"]>[number]

export type WatchHomeCarouselAction = {
  label: string
  url: string
}

export type WatchHomeCarouselBaseSlide = {
  id: string
  title: string
  label: string
  collectionTitle: string | null
  description: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  src: string
  muxPlaybackId: string | null
  durationSeconds: number | null
}

export type WatchHomeCarouselVideoSlide = WatchHomeCarouselBaseSlide & {
  kind: "video"
  videoId: string
  videoSlug: string
  languageSlug: string
  href: string
}

export type WatchHomeCarouselMuxSlide = WatchHomeCarouselBaseSlide & {
  kind: "mux"
  action: WatchHomeCarouselAction | null
  logo: boolean
}

export type WatchHomeCarouselSlide =
  | WatchHomeCarouselVideoSlide
  | WatchHomeCarouselMuxSlide

export type WatchHomeCarouselMissingData = {
  missingCollections: string[]
  skippedVideos: Array<{
    id: string
    slug: string | null
    reason: "missing_slug" | "missing_title" | "missing_playable_variant"
  }>
  fallbackPoolUsed: boolean
}

export type WatchHomeCarouselData = {
  languageSlug: string
  slides: WatchHomeCarouselSlide[]
  missingData: WatchHomeCarouselMissingData
}

type VideoPoolParams = {
  category?: "SHORT_FILMS" | null
  collection?: string | null
  languageSlug: string
  limit: number
  locale: string
}

type VideoPoolResult = {
  collection: string | null
  videos: AdminWatchHomeVideo[]
}

function muxStreamUrl(playbackId: string) {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

function muxPosterUrl(playbackId: string, width = 1280) {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=720&fit_mode=smartcrop`
}

function displayLabel(label: string | null | undefined): string {
  if (!label) return "ITEM"
  return label.replace(/_/g, " ")
}

function firstImageUrl(image: AdminWatchHomeImage | null | undefined) {
  return (
    image?.mobileCinematicHigh ??
    image?.mobileCinematicLow ??
    image?.url ??
    null
  )
}

function firstThumbnailUrl(
  image: AdminWatchHomeImage | null | undefined,
  playbackId: string | null,
) {
  return (
    image?.thumbnail ??
    image?.mobileCinematicLow ??
    image?.mobileCinematicHigh ??
    (playbackId ? muxPosterUrl(playbackId, 640) : null)
  )
}

function selectedPlayableVariant(
  variants: readonly AdminWatchHomeVariant[] | null | undefined,
): AdminWatchHomeVariant | null {
  return (
    variants?.find(
      (variant) => variant?.published === true && Boolean(variant.hls),
    ) ?? null
  )
}

function selectedLocaleRow(video: AdminWatchHomeVideo) {
  const rows: Array<AdminWatchHomeLocale | null | undefined> = [
    video.locales?.[0],
    video.fallbackLocales?.[0],
    video.defaultLocales?.[0],
  ]
  return rows.find((row) => row?.title?.trim()) ?? null
}

export function normalizeWatchHomeVideoSlide(
  video: AdminWatchHomeVideo,
  requestedLanguageSlug: string,
): {
  slide: WatchHomeCarouselVideoSlide | null
  skipped: WatchHomeCarouselMissingData["skippedVideos"][number] | null
} {
  const id = video.documentId ?? video.coreId ?? video.slug ?? "unknown-video"
  const slug = video.slug ?? null
  if (!slug) {
    return {
      slide: null,
      skipped: { id, slug, reason: "missing_slug" },
    }
  }

  const localeRow = selectedLocaleRow(video)
  const title = localeRow?.title?.trim() ?? ""
  if (!title) {
    return {
      slide: null,
      skipped: { id, slug, reason: "missing_title" },
    }
  }

  const variant = selectedPlayableVariant(video.variants)
  if (!variant?.hls) {
    return {
      slide: null,
      skipped: { id, slug, reason: "missing_playable_variant" },
    }
  }

  const languageSlug =
    variant.language?.slug ?? variant.slug ?? requestedLanguageSlug
  const contentSlug = tryAsContentSlug(slug)
  const localeSlug = tryAsLocaleSlug(languageSlug)
  if (!contentSlug || !localeSlug) {
    return {
      slide: null,
      skipped: { id, slug, reason: "missing_slug" },
    }
  }

  const image = video.images?.[0] ?? null
  const muxPlaybackId = variant.muxVideo?.playbackId ?? null
  const posterUrl =
    resolvePosterUrl(image, muxPlaybackId) ??
    firstImageUrl(image) ??
    (muxPlaybackId ? muxPosterUrl(muxPlaybackId) : null)

  return {
    slide: {
      kind: "video",
      id: `video-${video.documentId ?? slug}`,
      videoId: video.documentId ?? id,
      videoSlug: slug,
      languageSlug,
      href: watchVideoPath(contentSlug, localeSlug),
      title,
      label: displayLabel(video.label),
      collectionTitle: null,
      description: localeRow?.snippet ?? null,
      posterUrl,
      thumbnailUrl: firstThumbnailUrl(image, muxPlaybackId) ?? posterUrl,
      src: variant.hls,
      muxPlaybackId,
      durationSeconds: variant.duration ?? video.durationSeconds ?? null,
    },
    skipped: null,
  }
}

function datePrefix(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(now)
}

export function muxInsertToSlide(
  insert: WatchHomeMuxInsertConfig,
  now: Date,
): WatchHomeCarouselMuxSlide {
  const title =
    insert.trigger.type === "sequence-start"
      ? `${datePrefix(now)}: ${insert.title}`
      : insert.title

  return {
    kind: "mux",
    id: `mux-${insert.id}`,
    title,
    label: insert.label,
    collectionTitle: insert.collectionTitle,
    description: insert.description,
    action: insert.action,
    logo: insert.logo,
    posterUrl: muxPosterUrl(insert.playbackId),
    thumbnailUrl: muxPosterUrl(insert.playbackId, 640),
    src: muxStreamUrl(insert.playbackId),
    muxPlaybackId: insert.playbackId,
    durationSeconds: insert.durationSeconds,
  }
}

export function mergeMuxInsertSlides(
  videoSlides: readonly WatchHomeCarouselVideoSlide[],
  now: Date,
): WatchHomeCarouselSlide[] {
  const startInserts = WATCH_HOME_MUX_INSERTS.filter(
    (insert) => insert.trigger.type === "sequence-start",
  )
  const afterCountInserts = WATCH_HOME_MUX_INSERTS.filter(
    (insert) => insert.trigger.type === "after-count",
  )

  const slides: WatchHomeCarouselSlide[] = startInserts.map((insert) =>
    muxInsertToSlide(insert, now),
  )

  videoSlides.forEach((slide, index) => {
    slides.push(slide)
    const videoCount = index + 1
    for (const insert of afterCountInserts) {
      if (
        insert.trigger.type === "after-count" &&
        insert.trigger.count === videoCount
      ) {
        slides.push(muxInsertToSlide(insert, now))
      }
    }
  })

  return slides
}

function flattenPlaylistCollections(): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of WATCH_HOME_PLAYLIST_SEQUENCE) {
    for (const collection of group) {
      if (
        seen.has(collection) ||
        WATCH_HOME_COLLECTION_BLACKLIST.has(collection)
      ) {
        continue
      }
      seen.add(collection)
      result.push(collection)
    }
  }
  return result
}

function emptyMissingData(): WatchHomeCarouselMissingData {
  return {
    missingCollections: [],
    skippedVideos: [],
    fallbackPoolUsed: false,
  }
}

async function fetchVideoPool({
  category = null,
  collection = null,
  languageSlug,
  limit,
  locale,
}: VideoPoolParams): Promise<VideoPoolResult> {
  const result = await client.query({
    query: GET_WATCH_HOME_CAROUSEL_VIDEOS,
    variables: {
      category,
      collection,
      languageSlug,
      limit,
      locale,
      offset: 0,
      sort: "RECENT",
    },
    fetchPolicy: "no-cache",
  })

  if (result.error) throw result.error
  return {
    collection,
    videos: [...(result.data?.videos ?? [])],
  }
}

function dedupeVideoSlides(
  videos: readonly AdminWatchHomeVideo[],
  languageSlug: string,
  missingData: WatchHomeCarouselMissingData,
) {
  const seen = new Set<string>()
  const slides: WatchHomeCarouselVideoSlide[] = []

  for (const video of videos) {
    const key = video.documentId ?? video.slug ?? video.coreId ?? null
    if (!key || seen.has(key)) continue
    seen.add(key)
    const normalized = normalizeWatchHomeVideoSlide(video, languageSlug)
    if (normalized.slide) {
      slides.push(normalized.slide)
    } else if (normalized.skipped) {
      missingData.skippedVideos.push(normalized.skipped)
    }
  }

  return slides
}

async function resolveWatchHomeCarouselUncached(
  locale: string,
  rawLanguageSlug?: string | null,
): Promise<WatchHomeCarouselData> {
  const languageSlug = rawLanguageSlug || DEFAULT_WATCH_HOME_LANGUAGE_SLUG
  const missingData = emptyMissingData()
  const collections = flattenPlaylistCollections().slice(0, 12)

  const [collectionPools, shortFilmPool] = await Promise.all([
    Promise.all(
      collections.map((collection) =>
        fetchVideoPool({
          collection,
          languageSlug,
          limit: 4,
          locale,
        }),
      ),
    ),
    fetchVideoPool({
      category: "SHORT_FILMS",
      languageSlug,
      limit: 20,
      locale,
    }),
  ])

  for (const pool of collectionPools) {
    if (pool.collection && pool.videos.length === 0) {
      missingData.missingCollections.push(pool.collection)
    }
  }

  const orderedVideos = [
    ...collectionPools.flatMap((pool) => pool.videos),
    ...shortFilmPool.videos,
  ]

  let videoSlides = dedupeVideoSlides(orderedVideos, languageSlug, missingData)

  if (videoSlides.length < 6) {
    const fallbackPool = await fetchVideoPool({
      languageSlug,
      limit: 24,
      locale,
    })
    missingData.fallbackPoolUsed = true
    videoSlides = dedupeVideoSlides(
      [...orderedVideos, ...fallbackPool.videos],
      languageSlug,
      missingData,
    )
  }

  const slides = mergeMuxInsertSlides(
    videoSlides.slice(0, WATCH_HOME_MAX_VIDEO_SLIDES),
    new Date(),
  )

  return {
    languageSlug,
    slides,
    missingData,
  }
}

const fetchWatchHomeCarousel = unstable_cache(
  resolveWatchHomeCarouselUncached,
  ["watch-home-carousel"],
  { revalidate: 60 },
)

export const resolveWatchHomeCarousel = cache(
  async (
    locale: string,
    languageSlug?: string | null,
  ): Promise<WatchHomeCarouselData> => {
    return fetchWatchHomeCarousel(locale, languageSlug ?? null)
  },
)
