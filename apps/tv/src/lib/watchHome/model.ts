/**
 * ADAPTED COPY of apps/mobile/src/lib/watchHome/model.ts (ported from apps/web/src/lib/watch-home.ts)
 * — sync obligation in ./config.ts. TV cuts: no carousel/pager (hero → `model.featured`), no
 * playbackId on cards (lazy streams; 9.5MB lean-bulk), time-of-day title from an INJECTED Date. Pure TS.
 */

import {
  ENGLISH_LANGUAGE_SLUG,
  WATCH_HOME_HERO_SOURCE_IDS,
  WATCH_HOME_FEATURED_RAIL,
  WATCH_HOME_SECTIONS,
  type WatchHomeSectionConfig,
  type WatchHomeSourceConfig,
} from "./config"
import { pickCardImage } from "../cardImage"

/**
 * Lean bulk-video input: card fields only, no dubs/variants. Mirrors the
 * `WatchHomeVideo` fragment in ./homeQueries.ts (`documentId: id` alias).
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
  /**
   * Raw wire enum (e.g. "SERIES") behind display-text `label`. Routing must
   * read THIS — shape predicates (isSeriesSearchResult) match uppercase wire
   * literals; display text silently breaks the branch, leaving only childCount.
   */
  rawLabel: string | null
  metaLabel: string | null
  imageUrl: string | null
  imageAlt: string
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
  // layout/orientation/showSequenceNumbers: sync-parity with mobile's model —
  // not yet wired to any TV renderer; TV renders all sections as rails.
  layout: "rail" | "grid"
  orientation: "horizontal" | "vertical"
  showSequenceNumbers: boolean
  cards: WatchHomeCard[]
}

export type WatchHomeModel = {
  featured: WatchHomeCard[]
  sections: WatchHomeSection[]
  missingData: WatchHomeMissingData[]
}

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

function labelText(label: string | null | undefined): string {
  return label ? (LABEL_TEXT[label] ?? "Video") : "Video"
}

function pickAdminImage(images: readonly WatchHomeImageInput[]): string | null {
  return pickCardImage(images, "card")
}

/**
 * Copy of apps/web/src/lib/format-duration.ts: `m:ss` sub-hour, `h:mm:ss`
 * hour-plus, `""` for invalid input.
 */
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

// KTD5: admin Video.parents/children relation is inverted on main and can
// surface self-refs/duplicates. Self-filter + dedupe BEFORE any limit slice so
// cards are correct the moment the relation is fixed, no further change here.
function resolvedChildren(
  parent: WatchHomeVideoInput,
): WatchHomeChildVideoInput[] {
  const seen = new Set<string>()
  const children: WatchHomeChildVideoInput[] = []
  for (const rel of parent.children ?? []) {
    const child = rel.child
    if (!child?.documentId || child.documentId === parent.documentId) continue
    if (seen.has(child.documentId)) continue
    seen.add(child.documentId)
    children.push(child)
  }
  return children
}

// Exported for the Experience adapter (experienceAdapter.ts): it hydrates each
// curated item by coreId and builds its card through this same normalizer, so
// rawLabel/childCount/metaLabel/title stay identical to the config path.
export function normalizeCard(args: {
  sectionId: string
  sourceId: string
  video: WatchHomeVideoInput | WatchHomeChildVideoInput
  languageSlug: string
  parent?: WatchHomeVideoInput | null
}): WatchHomeCard | null {
  if (!args.video.documentId || !args.video.coreId) return null
  const locale = args.video.locales?.[0] ?? null
  const adminImageUrl = pickAdminImage(args.video.images ?? [])
  const label = labelText(args.video.label)
  const childCount =
    "children" in args.video ? resolvedChildren(args.video).length : 0
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
      fallback: "Styled placeholder",
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
    rawLabel: args.video.label ?? null,
    metaLabel: buildMetaLabel({
      label,
      durationSeconds: args.video.durationSeconds ?? null,
      childCount,
    }),
    imageUrl: adminImageUrl,
    imageAlt: locale?.imageAlt ?? title,
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
    return resolvedChildren(parent)
      .slice(0, args.source.limitChildren)
      .map((child) =>
        normalizeCard({
          sectionId: args.sectionId,
          sourceId: args.source.id,
          video: child,
          parent,
          languageSlug: args.languageSlug,
        }),
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

  return resolvedChildren(parent)
    .slice(0, args.section.childLimit ?? 12)
    .map((child) =>
      normalizeCard({
        sectionId: args.section.id,
        sourceId: collectionId,
        video: child,
        parent,
        languageSlug: args.languageSlug,
      }),
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

// Web's heroSlides recipe: each hero source id resolves to its own record's
// card (never a child). Unresolved sources are omitted and recorded.
function buildFeatured(args: {
  videoByCoreId: Map<string, WatchHomeVideoInput>
  languageSlug: string
  missingData: WatchHomeMissingData[]
}): WatchHomeCard[] {
  const featured: WatchHomeCard[] = []
  for (const sourceId of WATCH_HOME_HERO_SOURCE_IDS) {
    const video = args.videoByCoreId.get(sourceId)
    if (!video) {
      args.missingData.push({
        sectionId: WATCH_HOME_FEATURED_RAIL.id,
        sourceId,
        field: "record",
        detail: `Admin watchHomeVideos did not return hero source Core id ${sourceId}.`,
        fallback: "Featured card omitted",
        followUp:
          "Verify the Core id exists in admin sync or replace the hero source.",
      })
      continue
    }
    const card = normalizeCard({
      sectionId: WATCH_HOME_FEATURED_RAIL.id,
      sourceId,
      video,
      languageSlug: args.languageSlug,
    })
    if (card) featured.push(card)
  }
  return featured
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
 * KTD4: index BOTH the top-level records AND every `children[].child` by coreId, so
 * the Experience adapter can hydrate a curated item that lives only as another
 * collection's child (20 of prod's 42 unique item ids). On a coreId present both
 * ways the TOP-LEVEL record wins (inserted last) so normalizeCard sees `children`
 * and reports a real childCount. Both the config model and the adapter consume this.
 */
export function buildVideoByCoreIdIndex(
  videos: readonly WatchHomeVideoInput[],
): Map<string, WatchHomeVideoInput> {
  const index = new Map<string, WatchHomeVideoInput>()
  for (const video of videos) {
    for (const child of resolvedChildren(video)) {
      if (hasCoreId(child)) index.set(child.coreId, child)
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
      sectionId: "home-sections",
      sourceId: "source-app",
      field: "local-thumbnail",
      detail:
        "The source app has local thumbnail/poster overrides that are not represented as admin records.",
      fallback: "Admin images or styled placeholders",
      followUp:
        "Ingest source thumbnail overrides into admin/Core image data or configure editor-owned poster assets.",
    },
  ]
  const videoByCoreId = buildVideoByCoreIdIndex(args.videos)

  const featured = buildFeatured({ videoByCoreId, languageSlug, missingData })
  const sections = buildSections({ videoByCoreId, languageSlug, missingData })
  const cardMissing = [
    ...featured.flatMap((card) => card.missingData),
    ...sections.flatMap((section) =>
      section.cards.flatMap((card) => card.missingData),
    ),
  ]

  return {
    featured,
    sections,
    missingData: dedupeMissingData([...missingData, ...cardMissing]),
  }
}
