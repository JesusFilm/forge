import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
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
import {
  WATCH_HOME_PROGRAM_DELIVERY_LIMITS,
  type WatchHomeProgram,
  type WatchHomeProgramAction,
  type WatchHomeProgramPromoItem,
  type WatchHomeProgramVideoItem,
} from "@/lib/watch-home-types"

type WatchHomeVideosData = AdminResultOf<typeof getWatchHomeVideosOperation>
const getWatchHomeEditorialOverridesOperation = adminGraphql(
  `
    query GetWatchHomeEditorialOverrides($locale: String!) {
      watchSetting(locale: $locale) {
        homepageExperience {
          blocks {
            __typename
            ... on MediaCollectionBlock {
              sectionKey
              items {
                videoId
                imageUrl
                imageBlurDataUrl
                imageDominantColor
                imageOverrideUrl
                imageOverrideBlurDataUrl
                imageOverrideDominantColor
              }
            }
            ... on VideoCarouselBlock {
              sectionKey
              items {
                videoId
                imageUrl
                imageOverrideUrl
              }
            }
          }
        }
      }
    }
  `,
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
  program?: WatchHomeProgram | null
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
const WATCH_HOME_VIDEO_HYDRATION_BATCH_SIZE = 100

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

function boundedString(value: unknown, max: number) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

function optionalBoundedString(value: unknown, max: number) {
  return value == null ? null : boundedString(value, max)
}

function stableProgramId(value: unknown) {
  const id = boundedString(
    value,
    WATCH_HOME_PROGRAM_DELIVERY_LIMITS.labelCharacters,
  )
  return id && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : null
}

function isAllowedWatchHomeActionHref(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) {
    try {
      const url = new URL(value, "https://www.jesusfilm.org")
      return url.origin === "https://www.jesusfilm.org"
    } catch {
      return false
    }
  }

  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return false
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
    return (
      hostname === "jesusfilm.org" ||
      hostname.endsWith(".jesusfilm.org") ||
      hostname === "your.nextstep.is"
    )
  } catch {
    return false
  }
}

function isSafeProgramPosterUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === "https:") return true
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

type OptionalActionResult =
  | { valid: true; action: WatchHomeProgramAction | null }
  | { valid: false; action: null }

function normalizeProgramAction(value: unknown): OptionalActionResult {
  if (value == null) return { valid: true, action: null }
  const label = boundedString(
    recordValue(value, "label"),
    WATCH_HOME_PROGRAM_DELIVERY_LIMITS.actionLabelCharacters,
  )
  const href = boundedString(recordValue(value, "href"), 2_048)
  const iconValue = recordValue(value, "icon")
  const icon = iconValue === "join" || iconValue === "share" ? iconValue : null
  if (!label || !href || !isAllowedWatchHomeActionHref(href)) {
    return { valid: false, action: null }
  }
  if (iconValue != null && icon == null) {
    return { valid: false, action: null }
  }
  return { valid: true, action: { label, href, icon } }
}

function normalizeProgramPromo(
  value: unknown,
): WatchHomeProgramPromoItem | null {
  const id = stableProgramId(recordValue(value, "id"))
  const playbackId = boundedString(recordValue(value, "playbackId"), 2_048)
  const posterUrl = boundedString(recordValue(value, "posterUrl"), 2_048)
  const title = boundedString(
    recordValue(value, "title"),
    WATCH_HOME_PROGRAM_DELIVERY_LIMITS.titleCharacters,
  )
  const label = optionalBoundedString(
    recordValue(value, "label"),
    WATCH_HOME_PROGRAM_DELIVERY_LIMITS.labelCharacters,
  )
  const description = optionalBoundedString(
    recordValue(value, "description"),
    WATCH_HOME_PROGRAM_DELIVERY_LIMITS.descriptionCharacters,
  )
  const primaryAction = normalizeProgramAction(
    recordValue(value, "primaryAction"),
  )
  const secondaryAction = normalizeProgramAction(
    recordValue(value, "secondaryAction"),
  )
  const durationValue = recordValue(value, "durationSeconds")
  const durationSeconds =
    typeof durationValue === "number" &&
    Number.isFinite(durationValue) &&
    durationValue > 0 &&
    durationValue <= 86_400
      ? durationValue
      : null
  const showLogoValue = recordValue(value, "showLogo")

  if (
    !id ||
    !playbackId ||
    !/^[A-Za-z0-9_-]+$/.test(playbackId) ||
    !posterUrl ||
    !isSafeProgramPosterUrl(posterUrl) ||
    !title ||
    (recordValue(value, "label") != null && label == null) ||
    (recordValue(value, "description") != null && description == null) ||
    (durationValue != null && durationSeconds == null) ||
    (showLogoValue != null && typeof showLogoValue !== "boolean") ||
    !primaryAction.valid ||
    !secondaryAction.valid
  ) {
    return null
  }

  return {
    id,
    playbackId,
    src: `https://stream.mux.com/${playbackId}.m3u8`,
    durationSeconds,
    posterUrl,
    label,
    title,
    description,
    showLogo: showLogoValue === true,
    primaryAction: primaryAction.action,
    secondaryAction: secondaryAction.action,
  }
}

function normalizeProgramVideo(args: {
  value: unknown
  videoByCoreId: ReadonlyMap<string, AdminHomeVideo>
  languageSlug: string
}): WatchHomeProgramVideoItem | null {
  const id = stableProgramId(recordValue(args.value, "id"))
  const videoId = boundedString(recordValue(args.value, "videoId"), 200)
  const coreId = boundedString(recordValue(args.value, "coreId"), 200)
  if (!id || !videoId || !coreId) return null

  const video = args.videoByCoreId.get(coreId)
  if (
    !video ||
    video.documentId !== videoId ||
    video.label === "COLLECTION" ||
    video.label === "SERIES"
  ) {
    return null
  }
  const card = normalizeCard({
    sectionId: "home-program",
    sourceId: coreId,
    video,
    languageSlug: args.languageSlug,
  })
  const slide = card ? cardToCarouselSlide(card) : null
  if (!slide?.src) return null

  return {
    id,
    videoId,
    coreId,
    title: slide.title,
    description: slide.description,
    label: slide.label,
    href: slide.href,
    posterUrl: slide.posterUrl,
    thumbnailUrl: slide.thumbnailUrl,
    imageAlt: slide.imageAlt,
    src: slide.src,
    playbackId: slide.playbackId,
    subtitleVttSrc: slide.subtitleVttSrc ?? null,
    subtitleLanguageBcp47: slide.subtitleLanguageBcp47 ?? null,
    durationSeconds: slide.durationSeconds,
  }
}

export function collectWatchHomeProgramCoreIds(
  blocks: readonly WatchHomeExperienceBlock[] | null | undefined,
): string[] {
  const ids = new Set<string>()
  for (const block of blocks ?? []) {
    if (recordValue(block, "__typename") !== "WatchHomeHeroBlock") continue
    const buckets = recordValue(recordValue(block, "program"), "buckets")
    if (!Array.isArray(buckets)) continue
    for (const bucket of buckets) {
      if (recordValue(bucket, "kind") !== "video") continue
      const items = recordValue(bucket, "items")
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const coreId = boundedString(recordValue(item, "coreId"), 200)
        if (coreId) ids.add(coreId)
        if (ids.size >= WATCH_HOME_PROGRAM_DELIVERY_LIMITS.uniqueVideos) {
          return [...ids]
        }
      }
    }
  }
  return [...ids]
}

export function normalizeWatchHomeProgram(args: {
  blocks: readonly WatchHomeExperienceBlock[] | null | undefined
  videoByCoreId: ReadonlyMap<string, AdminHomeVideo>
  languageSlug: string
}): WatchHomeProgram | null {
  const heroBlock = (args.blocks ?? []).find(
    (block) => recordValue(block, "__typename") === "WatchHomeHeroBlock",
  )
  const rawProgram = recordValue(heroBlock, "program")
  if (typeof rawProgram !== "object" || rawProgram == null) return null

  try {
    if (
      new TextEncoder().encode(JSON.stringify(rawProgram)).byteLength >
      WATCH_HOME_PROGRAM_DELIVERY_LIMITS.bytes
    ) {
      return null
    }
  } catch {
    return null
  }

  const rawBuckets = recordValue(rawProgram, "buckets")
  const rawRotation = recordValue(rawProgram, "rotation")
  if (
    !Array.isArray(rawBuckets) ||
    rawBuckets.length < 1 ||
    rawBuckets.length > WATCH_HOME_PROGRAM_DELIVERY_LIMITS.buckets ||
    !Array.isArray(rawRotation) ||
    rawRotation.length < 1 ||
    rawRotation.length > WATCH_HOME_PROGRAM_DELIVERY_LIMITS.rotationSlots
  ) {
    return null
  }

  const bucketIds = new Set<string>()
  const itemIds = new Set<string>()
  const uniqueVideoIds = new Set<string>()
  let promoCount = 0
  const buckets: WatchHomeProgram["buckets"] = []
  for (const rawBucket of rawBuckets) {
    const kind = recordValue(rawBucket, "kind")
    const id = stableProgramId(recordValue(rawBucket, "id"))
    const label = boundedString(
      recordValue(rawBucket, "label"),
      WATCH_HOME_PROGRAM_DELIVERY_LIMITS.labelCharacters,
    )
    const rawItems = recordValue(rawBucket, "items")
    if (
      (kind !== "video" && kind !== "promo") ||
      !id ||
      !label ||
      bucketIds.has(id) ||
      !Array.isArray(rawItems) ||
      rawItems.length > WATCH_HOME_PROGRAM_DELIVERY_LIMITS.itemsPerBucket
    ) {
      return null
    }
    bucketIds.add(id)

    if (kind === "video") {
      const items: WatchHomeProgramVideoItem[] = []
      const bucketVideoIds = new Set<string>()
      for (const rawItem of rawItems) {
        const itemId = stableProgramId(recordValue(rawItem, "id"))
        const videoId = boundedString(recordValue(rawItem, "videoId"), 200)
        if (
          !itemId ||
          !videoId ||
          itemIds.has(itemId) ||
          bucketVideoIds.has(videoId)
        ) {
          return null
        }
        itemIds.add(itemId)
        bucketVideoIds.add(videoId)
        uniqueVideoIds.add(videoId)
        const item = normalizeProgramVideo({
          value: rawItem,
          videoByCoreId: args.videoByCoreId,
          languageSlug: args.languageSlug,
        })
        if (item) items.push(item)
      }
      buckets.push({ kind, id, label, items })
    } else {
      const items: WatchHomeProgramPromoItem[] = []
      for (const rawItem of rawItems) {
        const itemId = stableProgramId(recordValue(rawItem, "id"))
        if (!itemId || itemIds.has(itemId)) return null
        itemIds.add(itemId)
        promoCount += 1
        const item = normalizeProgramPromo(rawItem)
        if (item) items.push(item)
      }
      buckets.push({ kind, id, label, items })
    }
  }

  const rotation = rawRotation.map(stableProgramId)
  if (
    uniqueVideoIds.size > WATCH_HOME_PROGRAM_DELIVERY_LIMITS.uniqueVideos ||
    rotation.some((id) => id == null || !bucketIds.has(id))
  ) {
    return null
  }

  const rawIntro = recordValue(rawProgram, "intro")
  const intro = rawIntro == null ? null : normalizeProgramPromo(rawIntro)
  if (rawIntro != null) {
    const introId = stableProgramId(recordValue(rawIntro, "id"))
    if (!introId || itemIds.has(introId)) return null
    promoCount += 1
  }
  if (promoCount > WATCH_HOME_PROGRAM_DELIVERY_LIMITS.promos) return null

  if (!intro && buckets.every((bucket) => bucket.items.length === 0)) {
    return null
  }

  return {
    intro,
    buckets,
    rotation: rotation as string[],
  }
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
    videoId: card.id,
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
  const program = normalizeWatchHomeProgram({
    blocks: args.experienceBlocks,
    videoByCoreId,
    languageSlug,
  })
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
    program,
    missingData: dedupeMissingData([...missingData, ...cardMissing]),
  }
}

async function fetchWatchHomeModel(
  locale: string,
  languageSlug: string,
  suppliedExperienceBlocks?: readonly WatchHomeExperienceBlock[] | null,
): Promise<WatchHomeModel> {
  let experienceBlocks = suppliedExperienceBlocks
  if (suppliedExperienceBlocks === undefined) {
    const overridesResult = await client.query({
      query: getWatchHomeEditorialOverridesOperation,
      variables: { locale },
      fetchPolicy: "no-cache",
    })
    const overridesError = graphqlError(
      overridesResult as { error?: ErrorLike; errors?: unknown[] },
    )
    experienceBlocks = overridesError
      ? null
      : (overridesResult.data?.watchSetting?.homepageExperience?.blocks ?? null)
  }

  const coreIds = [
    ...new Set([
      ...getWatchHomeCoreIds(),
      ...collectWatchHomeProgramCoreIds(experienceBlocks),
    ]),
  ]
  const videoResults = await Promise.all(
    Array.from(
      {
        length: Math.ceil(
          coreIds.length / WATCH_HOME_VIDEO_HYDRATION_BATCH_SIZE,
        ),
      },
      (_, batchIndex) =>
        client.query({
          query: getWatchHomeVideosOperation,
          variables: {
            coreIds: coreIds.slice(
              batchIndex * WATCH_HOME_VIDEO_HYDRATION_BATCH_SIZE,
              (batchIndex + 1) * WATCH_HOME_VIDEO_HYDRATION_BATCH_SIZE,
            ),
            locale,
            languageSlug,
          },
          fetchPolicy: "no-cache",
        }),
    ),
  )

  for (const videosResult of videoResults) {
    const error = graphqlError(
      videosResult as { error?: ErrorLike; errors?: unknown[] },
    )
    if (error) throw error
  }

  return buildWatchHomeModelFromVideos({
    videos: videoResults.flatMap(
      (videosResult) => videosResult.data?.watchHomeVideos ?? [],
    ),
    locale,
    languageSlug,
    experienceBlocks,
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
    experienceBlocks?: readonly WatchHomeExperienceBlock[] | null,
  ): Promise<WatchHomeResult> => {
    try {
      const languageSlug = languageSlugOverride ?? selectedLanguageSlug(locale)
      const model = await getCachedWatchHomeModel(
        locale,
        languageSlug,
        experienceBlocks,
      )
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
