import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import { adminWatchExperienceFragment } from "@forge/admin-graphql/fragments"
import client from "@/lib/admin-client"
import { formatDuration } from "@/lib/format-duration"
import { localWatchHomeBlurDataUrl } from "@/lib/enrichment"
import { publicWatchHomeLanguageSlugForLocale } from "@/lib/locale"
import {
  asLocaleSlug,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import {
  WATCH_HOME_MUX_INSERTS,
  WATCH_HOME_PLAYLIST_SEQUENCE,
  getWatchHomeCoreIds,
  WATCH_HOME_CACHE_VERSION,
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_HERO_SOURCE_IDS,
  WATCH_HOME_SECTIONS,
  type WatchHomeSectionConfig,
  type WatchHomeSourceConfig,
} from "@/lib/watch-home-config"
import type {
  WatchHomeCarouselPool,
  WatchHomeCarouselSequenceData,
  WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"
import { getWatchHomeVideosOperation } from "@/lib/fragments/watch-home"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"

type WatchHomeVideosData = AdminResultOf<typeof getWatchHomeVideosOperation>
const getWatchHomeEditorialOverridesOperation = adminGraphql(
  `
    query GetWatchHomeEditorialOverrides($locale: String!) {
      watchSetting(locale: $locale) {
        homepageExperience {
          ...AdminWatchExperience
        }
      }
    }
  `,
  [adminWatchExperienceFragment],
)
type WatchHomeEditorialOverridesData = AdminResultOf<
  typeof getWatchHomeEditorialOverridesOperation
>
type AdminHomeVideo = WatchHomeVideosData["watchHomeVideos"][number]
type AdminHomeChildRelation = NonNullable<AdminHomeVideo["children"]>[number]
type AdminHomeChildVideo = NonNullable<AdminHomeChildRelation["child"]>
type AdminHomeImage = NonNullable<AdminHomeVideo["images"]>[number]
type AdminHomeVariant = NonNullable<AdminHomeVideo["preferredVariant"]>

export type WatchHomeMissingField =
  | "record"
  | "title"
  | "image"
  | "href"
  | "mux-insert"
  | "local-thumbnail"

export type WatchHomeMissingData = {
  sectionId: string
  sourceId: string
  field: WatchHomeMissingField
  detail: string
  fallback: string
  followUp: string
}

export type WatchHomeCard = {
  id: string
  sourceId: string
  coreId: string
  title: string
  description: string | null
  label: string
  metaLabel: string | null
  href: string | null
  imageUrl: string | null
  blurDataUrl: string | null
  dominantColor: string | null
  imageAlt: string
  hls: string | null
  playbackId: string | null
  subtitleVttSrc?: string | null
  subtitleLanguageBcp47?: string | null
  durationSeconds: number | null
  childCount: number
  parentCoreId: string | null
  parentSlug: string | null
  missingData: WatchHomeMissingData[]
}

export type WatchHomeHeroSlide = WatchHomeCard & {
  eyebrow: string
}

export type WatchHomeSection = {
  id: string
  eyebrow: string
  title: string
  description: string | null
  layout: "rail" | "grid"
  orientation: "horizontal" | "vertical"
  showSequenceNumbers: boolean
  cards: WatchHomeCard[]
}

export type WatchHomeModel = {
  heroSlides: WatchHomeHeroSlide[]
  sections: WatchHomeSection[]
  carousel: WatchHomeCarouselSequenceData
  missingData: WatchHomeMissingData[]
}

export type WatchHomeResult =
  | { data: WatchHomeModel; error: null }
  | { data: null; error: ErrorLike | Error }

type WatchHomeExperienceBlock = NonNullable<
  NonNullable<
    NonNullable<
      WatchHomeEditorialOverridesData["watchSetting"]
    >["homepageExperience"]
  >["blocks"]
>[number]

type MediaOverride = {
  imageUrl: string
  blurDataUrl: string | null
  dominantColor: string | null
}
type MediaOverrideMap = Map<string, MediaOverride>
type VideoOverrideRef = {
  documentId?: string | null
  coreId?: string | null
}

const ENGLISH_LANGUAGE_SLUG = asLocaleSlug("english")

const LABEL_TEXT: Record<string, string> = {
  BEHIND_THE_SCENES: "Behind the scenes",
  COLLECTION: "Collection",
  EPISODE: "Episode",
  FEATURE_FILM: "Feature film",
  SEGMENT: "Segment",
  SERIES: "Series",
  SHORT_FILM: "Short film",
  TRAILER: "Trailer",
}

function graphqlError(result: {
  error?: ErrorLike | null
  errors?: unknown[] | undefined
}): ErrorLike | Error | null {
  const graphqlErrors = result.errors?.filter(
    (entry): entry is { message?: string } =>
      typeof entry === "object" && entry !== null,
  )
  if (graphqlErrors?.length) {
    return new Error(
      graphqlErrors.map((entry) => entry.message ?? "Unknown").join("; "),
    )
  }

  return result.error ?? null
}

function selectedLanguageSlug(locale: string): string {
  return publicWatchHomeLanguageSlugForLocale(locale) ?? ENGLISH_LANGUAGE_SLUG
}

function overrideKey(sectionId: string, videoId: string) {
  return `${sectionId}:${videoId}`
}

function recordValue(value: unknown, key: string) {
  return typeof value === "object" && value != null
    ? (value as Record<string, unknown>)[key]
    : null
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function collectMediaOverrides(
  blocks: readonly WatchHomeExperienceBlock[] | null | undefined,
): MediaOverrideMap {
  const overrides: MediaOverrideMap = new Map()

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value !== "object" || value == null) return

    const sectionId =
      stringValue(recordValue(value, "sectionKey")) ??
      stringValue(recordValue(value, "id"))
    const items = recordValue(value, "items")
    if (sectionId && Array.isArray(items)) {
      for (const item of items) {
        const videoId = stringValue(recordValue(item, "videoId"))
        const imageUrl =
          stringValue(recordValue(item, "imageOverrideUrl")) ??
          stringValue(recordValue(item, "imageUrl"))
        const blurDataUrl =
          stringValue(recordValue(item, "imageOverrideBlurDataUrl")) ??
          stringValue(recordValue(item, "imageBlurDataUrl"))
        const dominantColor =
          stringValue(recordValue(item, "imageOverrideDominantColor")) ??
          stringValue(recordValue(item, "imageDominantColor"))
        if (videoId && imageUrl) {
          overrides.set(overrideKey(sectionId, videoId), {
            imageUrl,
            blurDataUrl,
            dominantColor,
          })
        }
      }
    }

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) visit(child)
    }
  }

  visit(blocks)
  return overrides
}

function applyMediaOverride(
  card: WatchHomeCard,
  args: {
    sectionId: string
    mediaOverrides: MediaOverrideMap
    video?: VideoOverrideRef | null
    sourceVideo?: VideoOverrideRef | null
  },
): WatchHomeCard {
  const candidates = [
    args.video?.documentId,
    args.video?.coreId,
    args.sourceVideo?.documentId,
    args.sourceVideo?.coreId,
    card.id,
    card.coreId,
    card.sourceId,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const override = args.mediaOverrides.get(
      overrideKey(args.sectionId, candidate),
    )
    if (override) {
      return {
        ...card,
        imageUrl: override.imageUrl,
        blurDataUrl: override.blurDataUrl,
        dominantColor: override.dominantColor,
      }
    }
  }
  return card
}

function labelText(label: string | null | undefined): string {
  return label ? (LABEL_TEXT[label] ?? "Video") : "Video"
}

function muxThumbnail(playbackId: string | null): string | null {
  return playbackId ? `https://image.mux.com/${playbackId}/thumbnail.jpg` : null
}

function adminImageUrl(image: AdminHomeImage) {
  return (
    image.mobileCinematicHigh ??
    image.mobileCinematicLow ??
    image.videoStill ??
    image.url ??
    image.thumbnail
  )
}

function pickAdminImage(images: readonly AdminHomeImage[]) {
  return images.find((image) => adminImageUrl(image)) ?? null
}

function buildMetaLabel(args: {
  label: string
  durationSeconds: number | null
  childCount: number
}): string | null {
  if (args.childCount > 0) {
    return `${args.childCount} ${args.childCount === 1 ? "episode" : "episodes"}`
  }
  if (args.durationSeconds != null) {
    const duration = formatDuration(args.durationSeconds)
    if (duration) return duration
  }
  return args.label
}

function buildHref(args: {
  slug: string | null
  parentSlug?: string | null
  languageSlug: string
}): string | null {
  const lang = tryAsLocaleSlug(args.languageSlug)
  const slug = args.slug ? tryAsContentSlug(args.slug) : null
  if (!lang || !slug) return null

  const parentSlug = args.parentSlug ? tryAsContentSlug(args.parentSlug) : null
  return parentSlug
    ? watchEpisodePath(parentSlug, slug, lang)
    : watchVideoPath(slug, lang)
}

function selectSubtitleTrack(
  variant: AdminHomeVariant | null,
  languageSlug: string,
): { vttSrc: string; bcp47: string | null } | null {
  const subtitles =
    variant?.videoEdition?.subtitles?.filter((subtitle) =>
      Boolean(subtitle.vttSrc),
    ) ?? []
  if (!subtitles.length) return null

  const selected =
    subtitles.find(
      (subtitle) => subtitle.language?.slug === variant?.language?.slug,
    ) ??
    subtitles.find((subtitle) => subtitle.language?.slug === languageSlug) ??
    subtitles.find((subtitle) => subtitle.primary === true) ??
    subtitles[0]

  return selected?.vttSrc
    ? {
        vttSrc: selected.vttSrc,
        bcp47: selected.language?.bcp47 ?? null,
      }
    : null
}

function missingEntry(args: WatchHomeMissingData): WatchHomeMissingData {
  return args
}

function normalizeCard(args: {
  sectionId: string
  sourceId: string
  video: AdminHomeVideo | AdminHomeChildVideo
  languageSlug: string
  parent?: AdminHomeVideo | null
}): WatchHomeCard | null {
  if (!args.video.documentId || !args.video.coreId) return null
  const locale = args.video.locales?.[0] ?? null
  const selectedVariant =
    "preferredVariant" in args.video
      ? (args.video.preferredVariant ?? null)
      : null
  const subtitleTrack = selectSubtitleTrack(selectedVariant, args.languageSlug)
  const playbackId = selectedVariant?.muxVideo?.playbackId ?? null
  const adminImage = pickAdminImage(args.video.images ?? [])
  const sourceImageUrl = adminImage
    ? adminImageUrl(adminImage)
    : muxThumbnail(playbackId)
  const imageBlurDataUrl = adminImage?.blurDataUrl ?? null
  const dominantColor = adminImage?.dominantColor ?? null
  const imageUrl = sourceImageUrl
  const blurDataUrl =
    imageBlurDataUrl ?? localWatchHomeBlurDataUrl(args.video.coreId)
  const label = labelText(args.video.label)
  const childCount =
    "children" in args.video && Array.isArray(args.video.children)
      ? args.video.children.length
      : 0
  const title = locale?.title ?? args.video.slug ?? args.video.coreId
  const href = buildHref({
    slug: args.video.slug ?? null,
    parentSlug: args.parent?.slug ?? null,
    languageSlug: args.languageSlug,
  })

  const missingData: WatchHomeMissingData[] = []
  if (!locale?.title) {
    missingData.push(
      missingEntry({
        sectionId: args.sectionId,
        sourceId: args.sourceId,
        field: "title",
        detail: `Admin returned ${args.video.coreId} without a localized title for ${args.languageSlug}.`,
        fallback: title,
        followUp:
          "Backfill or publish VideoLocale title data for the home language.",
      }),
    )
  }
  if (!adminImage) {
    missingData.push(
      missingEntry({
        sectionId: args.sectionId,
        sourceId: args.sourceId,
        field: "image",
        detail: `Admin returned ${args.video.coreId} without a usable cinematic/still image.`,
        fallback: sourceImageUrl ? "Mux thumbnail" : "Styled placeholder",
        followUp:
          "Ingest the source app local thumbnail override or enrich admin/Core image fields.",
      }),
    )
  }
  if (!href) {
    missingData.push(
      missingEntry({
        sectionId: args.sectionId,
        sourceId: args.sourceId,
        field: "href",
        detail: `Admin record ${args.video.coreId} does not have a valid public slug/language route pair.`,
        fallback: "Card renders without a link",
        followUp:
          "Fix the admin slug or language slug data before linking this card.",
      }),
    )
  }

  return {
    id: args.video.documentId,
    sourceId: args.sourceId,
    coreId: args.video.coreId,
    title,
    description: locale?.snippet ?? locale?.description ?? null,
    label,
    metaLabel: buildMetaLabel({
      label,
      durationSeconds: args.video.durationSeconds ?? null,
      childCount,
    }),
    href,
    imageUrl,
    blurDataUrl,
    dominantColor,
    imageAlt: locale?.imageAlt ?? title,
    hls: selectedVariant?.hls ?? null,
    playbackId,
    subtitleVttSrc: subtitleTrack?.vttSrc ?? null,
    subtitleLanguageBcp47: subtitleTrack?.bcp47 ?? null,
    durationSeconds:
      selectedVariant?.duration ?? args.video.durationSeconds ?? null,
    childCount,
    parentCoreId: args.parent?.coreId ?? null,
    parentSlug: args.parent?.slug ?? null,
    missingData,
  }
}

function cardEntriesForSource(args: {
  sectionId: string
  source: WatchHomeSourceConfig
  videoByCoreId: Map<string, AdminHomeVideo>
  languageSlug: string
  missingData: WatchHomeMissingData[]
  mediaOverrides: MediaOverrideMap
}): WatchHomeCard[] {
  const parent = args.videoByCoreId.get(args.source.id)
  if (!parent) {
    args.missingData.push(
      missingEntry({
        sectionId: args.sectionId,
        sourceId: args.source.id,
        field: "record",
        detail: `Admin watchHomeVideos did not return source Core id ${args.source.id}.`,
        fallback: "Section card omitted",
        followUp:
          "Verify the Core id exists in admin sync or replace the source id.",
      }),
    )
    return []
  }

  if ((args.source.limitChildren ?? 0) > 0) {
    return (parent.children ?? [])
      .slice(0, args.source.limitChildren)
      .map((rel) => {
        const card = rel.child
          ? normalizeCard({
              sectionId: args.sectionId,
              sourceId: args.source.id,
              video: rel.child,
              parent,
              languageSlug: args.languageSlug,
            })
          : null
        return card
          ? applyMediaOverride(card, {
              sectionId: args.sectionId,
              mediaOverrides: args.mediaOverrides,
              video: rel.child,
              sourceVideo: parent,
            })
          : null
      })
      .filter((card): card is WatchHomeCard => card != null)
  }

  const card = normalizeCard({
    sectionId: args.sectionId,
    sourceId: args.source.id,
    video: parent,
    languageSlug: args.languageSlug,
  })
  return card
    ? [
        applyMediaOverride(card, {
          sectionId: args.sectionId,
          mediaOverrides: args.mediaOverrides,
          video: parent,
          sourceVideo: parent,
        }),
      ]
    : []
}

function cardsForPrimaryCollection(args: {
  section: WatchHomeSectionConfig
  videoByCoreId: Map<string, AdminHomeVideo>
  languageSlug: string
  missingData: WatchHomeMissingData[]
  mediaOverrides: MediaOverrideMap
}): WatchHomeCard[] {
  const collectionId = args.section.primaryCollectionId
  if (!collectionId) return []
  const parent = args.videoByCoreId.get(collectionId)
  if (!parent) {
    args.missingData.push(
      missingEntry({
        sectionId: args.section.id,
        sourceId: collectionId,
        field: "record",
        detail: `Admin watchHomeVideos did not return primary collection ${collectionId}.`,
        fallback: "Section omitted",
        followUp:
          "Verify the collection exists in admin sync or update home programming.",
      }),
    )
    return []
  }

  return (parent.children ?? [])
    .slice(0, args.section.childLimit ?? 12)
    .map((rel) => {
      const card = rel.child
        ? normalizeCard({
            sectionId: args.section.id,
            sourceId: collectionId,
            video: rel.child,
            parent,
            languageSlug: args.languageSlug,
          })
        : null
      return card
        ? applyMediaOverride(card, {
            sectionId: args.section.id,
            mediaOverrides: args.mediaOverrides,
            video: rel.child,
            sourceVideo: parent,
          })
        : null
    })
    .filter((card): card is WatchHomeCard => card != null)
}

function buildSections(args: {
  videoByCoreId: Map<string, AdminHomeVideo>
  languageSlug: string
  missingData: WatchHomeMissingData[]
  mediaOverrides: MediaOverrideMap
}): WatchHomeSection[] {
  return WATCH_HOME_SECTIONS.map((section) => {
    const cards =
      section.sources != null
        ? section.sources.flatMap((source) =>
            cardEntriesForSource({
              sectionId: section.id,
              source,
              videoByCoreId: args.videoByCoreId,
              languageSlug: args.languageSlug,
              missingData: args.missingData,
              mediaOverrides: args.mediaOverrides,
            }),
          )
        : cardsForPrimaryCollection({
            section,
            videoByCoreId: args.videoByCoreId,
            languageSlug: args.languageSlug,
            missingData: args.missingData,
            mediaOverrides: args.mediaOverrides,
          })

    return {
      id: section.id,
      eyebrow: section.eyebrow,
      title: section.title,
      description: section.description ?? null,
      layout: section.layout,
      orientation: section.orientation ?? "horizontal",
      showSequenceNumbers: section.showSequenceNumbers ?? false,
      cards,
    }
  }).filter((section) => section.cards.length > 0)
}

function cardToCarouselSlide(
  card: WatchHomeCard,
): WatchHomeTvCarouselVideoSlide | null {
  if (!card.hls) return null
  if (WATCH_HOME_COLLECTION_BLACKLIST.has(card.coreId)) return null

  return {
    kind: "video",
    id: card.coreId,
    title: card.title,
    description: card.description,
    label: card.label,
    href: card.href,
    posterUrl: card.imageUrl,
    thumbnailUrl: card.imageUrl,
    imageAlt: card.imageAlt,
    src: card.hls,
    playbackId: card.playbackId,
    subtitleVttSrc: card.subtitleVttSrc,
    subtitleLanguageBcp47: card.subtitleLanguageBcp47,
    durationSeconds: card.durationSeconds,
  }
}

function playableSlidesForSource(args: {
  sectionId: string
  sourceId: string
  videoByCoreId: Map<string, AdminHomeVideo>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeTvCarouselVideoSlide[] {
  if (WATCH_HOME_COLLECTION_BLACKLIST.has(args.sourceId)) return []

  const parent = args.videoByCoreId.get(args.sourceId)
  if (!parent) {
    args.missingData.push(
      missingEntry({
        sectionId: args.sectionId,
        sourceId: args.sourceId,
        field: "record",
        detail: `Admin watchHomeVideos did not return carousel pool source Core id ${args.sourceId}.`,
        fallback: "Pool skipped",
        followUp:
          "Verify the Core id exists in admin sync or replace the carousel playlist source.",
      }),
    )
    return []
  }

  const childSlides = (parent.children ?? [])
    .map((rel) =>
      rel.child
        ? normalizeCard({
            sectionId: args.sectionId,
            sourceId: args.sourceId,
            video: rel.child,
            parent,
            languageSlug: args.languageSlug,
          })
        : null,
    )
    .filter((card): card is WatchHomeCard => card != null)
    .map(cardToCarouselSlide)
    .filter((slide): slide is WatchHomeTvCarouselVideoSlide => slide != null)

  if (childSlides.length > 0) return childSlides

  const card = normalizeCard({
    sectionId: args.sectionId,
    sourceId: args.sourceId,
    video: parent,
    languageSlug: args.languageSlug,
  })
  const slide = card ? cardToCarouselSlide(card) : null
  return slide ? [slide] : []
}

function buildCarouselPools(args: {
  videoByCoreId: Map<string, AdminHomeVideo>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeCarouselPool[] {
  const pools = WATCH_HOME_PLAYLIST_SEQUENCE.map((group, index) => {
    const collectionIds = group.filter(
      (id) => !WATCH_HOME_COLLECTION_BLACKLIST.has(id),
    )
    const videos = collectionIds.flatMap((sourceId) =>
      playableSlidesForSource({
        sectionId: "home-carousel",
        sourceId,
        videoByCoreId: args.videoByCoreId,
        languageSlug: args.languageSlug,
        missingData: args.missingData,
      }),
    )

    return {
      id: `playlist-${index}-${collectionIds.join("|")}`,
      collectionIds,
      videos,
    }
  }).filter((pool) => pool.videos.length > 0)

  const shortFilmById = new Map<string, WatchHomeTvCarouselVideoSlide>()
  for (const video of args.videoByCoreId.values()) {
    const cards: WatchHomeCard[] = []
    const parentCard = normalizeCard({
      sectionId: "home-carousel-short-films",
      sourceId: video.coreId ?? video.documentId ?? "unknown",
      video,
      languageSlug: args.languageSlug,
    })
    if (parentCard) cards.push(parentCard)
    for (const rel of video.children ?? []) {
      if (!rel.child || rel.child.label !== "SHORT_FILM") continue
      const childCard = normalizeCard({
        sectionId: "home-carousel-short-films",
        sourceId: video.coreId ?? video.documentId ?? "unknown",
        video: rel.child,
        parent: video,
        languageSlug: args.languageSlug,
      })
      if (childCard) cards.push(childCard)
    }

    for (const card of cards) {
      if (card.label !== "Short film") continue
      const slide = cardToCarouselSlide(card)
      if (slide) shortFilmById.set(slide.id, slide)
    }
  }

  if (shortFilmById.size > 0) {
    pools.push({
      id: "shortFilms",
      collectionIds: ["shortFilms"],
      videos: [...shortFilmById.values()],
    })
  }

  return pools
}

function dedupeMissingData(
  missingData: readonly WatchHomeMissingData[],
): WatchHomeMissingData[] {
  const seen = new Set<string>()
  const result: WatchHomeMissingData[] = []
  for (const item of missingData) {
    const key = `${item.sectionId}:${item.sourceId}:${item.field}:${item.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function hasCoreId(video: AdminHomeVideo): video is AdminHomeVideo & {
  coreId: string
} {
  return typeof video.coreId === "string" && video.coreId.length > 0
}

export function buildWatchHomeModelFromVideos(args: {
  videos: readonly AdminHomeVideo[]
  locale: string
  languageSlug?: string | null
  experienceBlocks?: readonly WatchHomeExperienceBlock[] | null
}): WatchHomeModel {
  const languageSlug = args.languageSlug ?? selectedLanguageSlug(args.locale)
  const missingData: WatchHomeMissingData[] = [
    {
      sectionId: "home-hero",
      sourceId: "source-app",
      field: "mux-insert",
      detail:
        "The source beta hero can include non-catalog Mux insert slides; admin currently exposes catalog videos only.",
      fallback: "Hero uses admin video slides",
      followUp:
        "Add an admin-managed hero insert model or map source Mux inserts into admin.",
    },
    {
      sectionId: "home-sections",
      sourceId: "source-app",
      field: "local-thumbnail",
      detail:
        "The source app has local thumbnail/poster overrides that are not represented as admin records.",
      fallback: "Admin images or Mux thumbnails",
      followUp:
        "Ingest source thumbnail overrides into admin/Core image data or configure editor-owned poster assets.",
    },
  ]
  const videoByCoreId = new Map(
    args.videos.filter(hasCoreId).map((video) => [video.coreId, video]),
  )
  const mediaOverrides = collectMediaOverrides(args.experienceBlocks)

  const heroSlides = WATCH_HOME_HERO_SOURCE_IDS.flatMap((sourceId) => {
    const video = videoByCoreId.get(sourceId)
    if (!video) {
      missingData.push(
        missingEntry({
          sectionId: "home-hero",
          sourceId,
          field: "record",
          detail: `Admin watchHomeVideos did not return hero source Core id ${sourceId}.`,
          fallback: "Hero slide omitted",
          followUp:
            "Verify the Core id exists in admin sync or replace the hero source.",
        }),
      )
      return []
    }

    const card = normalizeCard({
      sectionId: "home-hero",
      sourceId,
      video,
      languageSlug,
    })
    return card ? [{ ...card, eyebrow: "Featured" }] : []
  })

  const sections = buildSections({
    videoByCoreId,
    languageSlug,
    missingData,
    mediaOverrides,
  })
  const carousel = {
    pools: buildCarouselPools({ videoByCoreId, languageSlug, missingData }),
    muxInserts: WATCH_HOME_MUX_INSERTS,
  }
  const cardMissing = [
    ...heroSlides.flatMap((card) => card.missingData),
    ...sections.flatMap((section) =>
      section.cards.flatMap((card) => card.missingData),
    ),
  ]

  return {
    heroSlides,
    sections,
    carousel,
    missingData: dedupeMissingData([...missingData, ...cardMissing]),
  }
}

async function fetchWatchHomeModel(
  locale: string,
  languageSlug: string,
): Promise<WatchHomeModel> {
  const [videosResult, overridesResult] = await Promise.all([
    client.query({
      query: getWatchHomeVideosOperation,
      variables: {
        coreIds: getWatchHomeCoreIds(),
        locale,
        languageSlug,
      },
      fetchPolicy: "no-cache",
    }),
    client.query({
      query: getWatchHomeEditorialOverridesOperation,
      variables: { locale },
      fetchPolicy: "no-cache",
    }),
  ])

  const error = graphqlError(
    videosResult as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error
  const overridesError = graphqlError(
    overridesResult as { error?: ErrorLike; errors?: unknown[] },
  )
  if (overridesError) throw overridesError

  return buildWatchHomeModelFromVideos({
    videos: videosResult.data?.watchHomeVideos ?? [],
    locale,
    languageSlug,
    experienceBlocks:
      overridesResult.data?.watchSetting?.homepageExperience?.blocks ?? null,
  })
}

const getCachedWatchHomeModel = unstable_cache(
  fetchWatchHomeModel,
  ["watch-home", WATCH_HOME_CACHE_VERSION],
  { revalidate: 60, tags: [WATCH_CACHE_TAGS.home, WATCH_CACHE_TAGS.video] },
)

export const resolveWatchHome = cache(
  async (
    locale: string,
    languageSlugOverride?: string | null,
  ): Promise<WatchHomeResult> => {
    try {
      const languageSlug = languageSlugOverride ?? selectedLanguageSlug(locale)
      const model = await getCachedWatchHomeModel(locale, languageSlug)
      return {
        data: JSON.parse(JSON.stringify(model)) as WatchHomeModel,
        error: null,
      }
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error("Unknown error"),
      }
    }
  },
)
