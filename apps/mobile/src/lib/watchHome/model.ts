/**
 * ADAPTED COPY of apps/web/src/lib/watch-home.ts (pure model builder; sync obligation
 * in ./config.ts). Mobile diffs: no hrefs; lean input (KTD-2, playbackId null for lazy
 * resolve); carousel eligibility poster + slug (KTD-4); heroSlides not ported (HomeScreen builds the queue via buildWatchHomeHeroQueue).
 */

import {
  ENGLISH_LANGUAGE_SLUG,
  WATCH_HOME_COLLECTION_BLACKLIST,
  WATCH_HOME_HERO_SOURCE_IDS,
  WATCH_HOME_MUX_INSERTS,
  WATCH_HOME_PLAYLIST_SEQUENCE,
  WATCH_HOME_SECTIONS,
  type WatchHomeSectionConfig,
  type WatchHomeSourceConfig,
} from "./config"
import { pickCardImage } from "../cardImage"
import {
  isEligibleWatchHomeVideoSlide,
  type WatchHomeCarouselPool,
  type WatchHomeCarouselSequenceData,
  type WatchHomeVideoSlide,
} from "./carouselSequence"

/**
 * Lean bulk-video input shape (KTD-2): card fields only, no dubs/variants.
 * Mirrors the `watchHomeVideos` fragment (U3) with the `documentId: id` alias.
 */
export type WatchHomeImageInput = {
  url?: string | null
  thumbnail?: string | null
  mobileCinematicHigh?: string | null
  mobileCinematicLow?: string | null
  videoStill?: string | null
}

export type WatchHomeLocaleInput = {
  title?: string | null
  description?: string | null
  snippet?: string | null
  imageAlt?: string | null
}

export type WatchHomeChildVideoInput = {
  documentId?: string | null
  coreId?: string | null
  slug?: string | null
  label?: string | null
  durationSeconds?: number | null
  images?: readonly WatchHomeImageInput[] | null
  locales?: readonly WatchHomeLocaleInput[] | null
}

export type WatchHomeChildRelationInput = {
  child?: WatchHomeChildVideoInput | null
}

export type WatchHomeVideoInput = WatchHomeChildVideoInput & {
  children?: readonly WatchHomeChildRelationInput[] | null
}

export type WatchHomeMissingField =
  | "record"
  | "title"
  | "image"
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
  slug: string | null
  title: string
  description: string | null
  label: string
  metaLabel: string | null
  imageUrl: string | null
  imageAlt: string
  playbackId: string | null
  durationSeconds: number | null
  childCount: number
  parentCoreId: string | null
  parentSlug: string | null
  missingData: WatchHomeMissingData[]
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
  sections: WatchHomeSection[]
  carousel: WatchHomeCarouselSequenceData
  missingData: WatchHomeMissingData[]
}

export const LABEL_TEXT: Record<string, string> = {
  BEHIND_THE_SCENES: "Behind the scenes",
  COLLECTION: "Collection",
  EPISODE: "Episode",
  FEATURE_FILM: "Feature film",
  SEGMENT: "Segment",
  SERIES: "Series",
  SHORT_FILM: "Short film",
  TRAILER: "Trailer",
}

function labelText(label: string | null | undefined): string {
  return label ? (LABEL_TEXT[label] ?? "Video") : "Video"
}

export function muxThumbnail(playbackId: string | null): string | null {
  return playbackId ? `https://image.mux.com/${playbackId}/thumbnail.jpg` : null
}

export function pickAdminImage(
  images: readonly WatchHomeImageInput[],
): string | null {
  return pickCardImage(images, "card")
}

/** Copy of web's format-duration: `m:ss` sub-hour, `h:mm:ss` hour-plus, `""` if invalid. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => n.toString().padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
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

function normalizeCard(args: {
  sectionId: string
  sourceId: string
  video: WatchHomeVideoInput | WatchHomeChildVideoInput
  languageSlug: string
  parent?: WatchHomeVideoInput | null
}): WatchHomeCard | null {
  if (!args.video.documentId || !args.video.coreId) return null
  const locale = args.video.locales?.[0] ?? null
  // Lean bulk shape carries no dubs/variants (KTD-2); the playbackId slot
  // stays null until a later unit resolves streams lazily. The Mux-thumbnail
  // fallback in web's image chain is kept for when that lands.
  const playbackId: string | null = null
  const adminImageUrl = pickAdminImage(args.video.images ?? [])
  const imageUrl = adminImageUrl ?? muxThumbnail(playbackId)
  const label = labelText(args.video.label)
  const childCount =
    "children" in args.video && Array.isArray(args.video.children)
      ? args.video.children.length
      : 0
  const title = locale?.title ?? args.video.slug ?? args.video.coreId

  const missingData: WatchHomeMissingData[] = []
  if (!locale?.title) {
    missingData.push({
      sectionId: args.sectionId,
      sourceId: args.sourceId,
      field: "title",
      detail: `Admin returned ${args.video.coreId} without a localized title for ${args.languageSlug}.`,
      fallback: title,
      followUp:
        "Backfill or publish VideoLocale title data for the home language.",
    })
  }
  if (!adminImageUrl) {
    missingData.push({
      sectionId: args.sectionId,
      sourceId: args.sourceId,
      field: "image",
      detail: `Admin returned ${args.video.coreId} without a usable cinematic/still image.`,
      fallback: imageUrl ? "Mux thumbnail" : "Styled placeholder",
      followUp:
        "Ingest the source app local thumbnail override or enrich admin/Core image fields.",
    })
  }

  return {
    id: args.video.documentId,
    sourceId: args.sourceId,
    coreId: args.video.coreId,
    slug: args.video.slug ?? null,
    title,
    description: locale?.snippet ?? locale?.description ?? null,
    label,
    metaLabel: buildMetaLabel({
      label,
      durationSeconds: args.video.durationSeconds ?? null,
      childCount,
    }),
    imageUrl,
    imageAlt: locale?.imageAlt ?? title,
    playbackId,
    durationSeconds: args.video.durationSeconds ?? null,
    childCount,
    parentCoreId: args.parent?.coreId ?? null,
    parentSlug: args.parent?.slug ?? null,
    missingData,
  }
}

function cardEntriesForSource(args: {
  sectionId: string
  source: WatchHomeSourceConfig
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeCard[] {
  const parent = args.videoByCoreId.get(args.source.id)
  if (!parent) {
    args.missingData.push({
      sectionId: args.sectionId,
      sourceId: args.source.id,
      field: "record",
      detail: `Admin watchHomeVideos did not return source Core id ${args.source.id}.`,
      fallback: "Section card omitted",
      followUp:
        "Verify the Core id exists in admin sync or replace the source id.",
    })
    return []
  }

  if ((args.source.limitChildren ?? 0) > 0) {
    return (parent.children ?? [])
      .slice(0, args.source.limitChildren)
      .map((rel) =>
        rel.child
          ? normalizeCard({
              sectionId: args.sectionId,
              sourceId: args.source.id,
              video: rel.child,
              parent,
              languageSlug: args.languageSlug,
            })
          : null,
      )
      .filter((card): card is WatchHomeCard => card != null)
  }

  const card = normalizeCard({
    sectionId: args.sectionId,
    sourceId: args.source.id,
    video: parent,
    languageSlug: args.languageSlug,
  })
  return card ? [card] : []
}

function cardsForPrimaryCollection(args: {
  section: WatchHomeSectionConfig
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeCard[] {
  const collectionId = args.section.primaryCollectionId
  if (!collectionId) return []
  const parent = args.videoByCoreId.get(collectionId)
  if (!parent) {
    args.missingData.push({
      sectionId: args.section.id,
      sourceId: collectionId,
      field: "record",
      detail: `Admin watchHomeVideos did not return primary collection ${collectionId}.`,
      fallback: "Section omitted",
      followUp:
        "Verify the collection exists in admin sync or update home programming.",
    })
    return []
  }

  return (parent.children ?? [])
    .slice(0, args.section.childLimit ?? 12)
    .map((rel) =>
      rel.child
        ? normalizeCard({
            sectionId: args.section.id,
            sourceId: collectionId,
            video: rel.child,
            parent,
            languageSlug: args.languageSlug,
          })
        : null,
    )
    .filter((card): card is WatchHomeCard => card != null)
}

function buildSections(args: {
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
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
            }),
          )
        : cardsForPrimaryCollection({
            section,
            videoByCoreId: args.videoByCoreId,
            languageSlug: args.languageSlug,
            missingData: args.missingData,
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

function cardToCarouselSlide(card: WatchHomeCard): WatchHomeVideoSlide | null {
  if (WATCH_HOME_COLLECTION_BLACKLIST.has(card.coreId)) return null

  const slide: WatchHomeVideoSlide = {
    kind: "video",
    id: card.coreId,
    title: card.title,
    description: card.description,
    label: card.label,
    slug: card.slug,
    parentSlug: card.parentSlug,
    posterUrl: card.imageUrl,
    thumbnailUrl: card.imageUrl,
    imageAlt: card.imageAlt,
    playbackId: card.playbackId,
    durationSeconds: card.durationSeconds,
  }
  // KTD-4: poster + slug, not a build-time stream, gate carousel entry.
  return isEligibleWatchHomeVideoSlide(slide) ? slide : null
}

// Web-parity: the hero shows the PARENT film/collection, NOT its child episodes.
// Web's child expansion is effectively dead (its fragment omits child variants/hls,
// so every child fails the hls gate and it falls back to the parent) — match that.
function eligibleSlidesForSource(args: {
  sectionId: string
  sourceId: string
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeVideoSlide[] {
  if (WATCH_HOME_COLLECTION_BLACKLIST.has(args.sourceId)) return []

  const parent = args.videoByCoreId.get(args.sourceId)
  if (!parent) {
    args.missingData.push({
      sectionId: args.sectionId,
      sourceId: args.sourceId,
      field: "record",
      detail: `Admin watchHomeVideos did not return carousel pool source Core id ${args.sourceId}.`,
      fallback: "Pool skipped",
      followUp:
        "Verify the Core id exists in admin sync or replace the carousel playlist source.",
    })
    return []
  }

  // Label-based web-parity: drop collection/series containers (web omits them, no
  // playable stream). Keep playable films/shorts (feature films kept even when they
  // have chapter-children, e.g. JESUS).
  if (parent.label === "COLLECTION" || parent.label === "SERIES") return []

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
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeCarouselPool[] {
  const pools = WATCH_HOME_PLAYLIST_SEQUENCE.map((group, index) => {
    const collectionIds = group.filter(
      (id) => !WATCH_HOME_COLLECTION_BLACKLIST.has(id),
    )
    const videos = collectionIds.flatMap((sourceId) =>
      eligibleSlidesForSource({
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

  // Web-parity: only top-level SHORT_FILM records (parents) reach web's hero —
  // its child short films are hls-filtered out. Collect parent short films only.
  const shortFilmById = new Map<string, WatchHomeVideoSlide>()
  for (const video of args.videoByCoreId.values()) {
    const parentCard = normalizeCard({
      sectionId: "home-carousel-short-films",
      sourceId: video.coreId ?? video.documentId ?? "unknown",
      video,
      languageSlug: args.languageSlug,
    })
    if (!parentCard || parentCard.label !== "Short film") continue
    const slide = cardToCarouselSlide(parentCard)
    if (slide) shortFilmById.set(slide.id, slide)
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

function hasCoreId(video: WatchHomeVideoInput): video is WatchHomeVideoInput & {
  coreId: string
} {
  return typeof video.coreId === "string" && video.coreId.length > 0
}

/**
 * Index BOTH the top-level records AND every `children[].child` by coreId, so the
 * Experience adapter can hydrate a curated item that lives only as another
 * collection's child. On a coreId present both ways the TOP-LEVEL record wins
 * (inserted last) so its `children` (and real childCount) survive.
 */
export function buildVideoByCoreIdIndex(
  videos: readonly WatchHomeVideoInput[],
): Map<string, WatchHomeVideoInput> {
  const index = new Map<string, WatchHomeVideoInput>()
  for (const video of videos) {
    for (const rel of video.children ?? []) {
      const child = rel.child
      if (child?.coreId) index.set(child.coreId, child)
    }
  }
  for (const video of videos) {
    if (hasCoreId(video)) index.set(video.coreId, video)
  }
  return index
}

export function buildWatchHomeModelFromVideos(args: {
  videos: readonly WatchHomeVideoInput[]
  languageSlug?: string | null
}): WatchHomeModel {
  const languageSlug = args.languageSlug ?? ENGLISH_LANGUAGE_SLUG
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

  // Emit missing-data records for unresolved hero sources so operators can
  // see which hero videos are absent. The hero queue itself is not built here
  // — HomeScreen builds it via buildWatchHomeHeroQueue from model.carousel.
  for (const sourceId of WATCH_HOME_HERO_SOURCE_IDS) {
    if (!videoByCoreId.has(sourceId)) {
      missingData.push({
        sectionId: "home-hero",
        sourceId,
        field: "record",
        detail: `Admin watchHomeVideos did not return hero source Core id ${sourceId}.`,
        fallback: "Hero slide omitted",
        followUp:
          "Verify the Core id exists in admin sync or replace the hero source.",
      })
    }
  }

  const sections = buildSections({ videoByCoreId, languageSlug, missingData })
  const carousel: WatchHomeCarouselSequenceData = {
    pools: buildCarouselPools({ videoByCoreId, languageSlug, missingData }),
    muxInserts: WATCH_HOME_MUX_INSERTS,
  }
  const cardMissing = sections.flatMap((section) =>
    section.cards.flatMap((card) => card.missingData),
  )

  return {
    sections,
    carousel,
    missingData: dedupeMissingData([...missingData, ...cardMissing]),
  }
}
