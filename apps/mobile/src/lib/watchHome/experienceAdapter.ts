/**
 * Maps the `watch-home` Experience's flat MediaCollectionBlock items into the
 * existing WatchHomeSection[] shape (lean cards, matching web) so HomeShelf
 * renders unchanged. Non-collection blocks are skipped (hero is a silent placeholder).
 */
import { rewriteSeedPosterUrl } from "../mediaImageUrl"
import { resolveMediaCollectionCardOrientation } from "../mediaCollectionCardOrientation"
import { muxThumbnailFromPlaybackId } from "../muxThumbnail"
import {
  buildVideoByCoreIdIndex,
  buildWatchHomeModelFromVideos,
  pickAdminImage,
  type WatchHomeCard,
  type WatchHomeModel,
  type WatchHomeSection,
  type WatchHomeVideoInput,
} from "./model"

// Structural block shape — the precise gql.tada block unions assign to this;
// field access happens via a Record cast inside blockToSection.
type ExperienceBlock = { readonly __typename?: string | null }

type ExperienceItem = {
  videoId?: string | null
  // The stable video identity (e.g. "6_Acts0401") used to hydrate title/image
  // from the linked video when the item's own overrides are absent.
  coreId?: string | null
  muxPlaybackId?: string | null
  videoSlug?: string | null
  titleOverride?: string | null
  subtitleOverride?: string | null
  labelOverride?: string | null
  collectionSize?: string | null
  imageUrl?: string | null
  imageOverrideUrl?: string | null
}

// KTD10 parity: item coreIds ride as a $coreIds GraphQL variable, but validate
// before they reach the top-up union anyway.
const CORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
function isValidCoreId(coreId: string | null | undefined): coreId is string {
  return typeof coreId === "string" && CORE_ID_PATTERN.test(coreId)
}

type LayoutShape = {
  layout: WatchHomeSection["layout"]
  orientation: WatchHomeSection["orientation"]
}

// carousel → horizontal rail; grid → horizontal grid; collection → vertical
// (portrait) grid. An unrecognized or missing variant falls back to grid /
// horizontal, the least-disruptive layout (KTD4).
function mapVariant(variant: string | null | undefined): LayoutShape {
  switch (variant) {
    case "carousel":
      return { layout: "rail", orientation: "horizontal" }
    case "collection":
      return { layout: "grid", orientation: "vertical" }
    case "grid":
    default:
      return { layout: "grid", orientation: "horizontal" }
  }
}

// A rail whose every item has a poster override renders PORTRAIT regardless of
// variant: those overrides are vertical posters (curated art) a 16:9 card would
// crop. Cinematic rails (no override) stay landscape.
function isPortraitPosterRail(items: readonly ExperienceItem[]): boolean {
  return (
    items.length > 0 &&
    items.every(
      (it) =>
        typeof it.imageOverrideUrl === "string" &&
        it.imageOverrideUrl.trim() !== "",
    )
  )
}

function itemToCard(
  item: ExperienceItem,
  sourceId: string,
  index: number,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
): WatchHomeCard | null {
  // Match web's enrichment: curated home items carry videoId but a null
  // videoSlug, so keep the card (image + title) with an empty slug — HomeCard
  // skips navigation on an empty slug rather than dropping the card.
  const slug = item.videoSlug ?? ""
  // `||` not `??`: an empty-string videoId must fall through to the slug, so the
  // `!coreId` drop below stays consistent (a valid slug is never dropped).
  const cardCoreId = item.videoId || slug
  if (!cardCoreId) return null // no id and no slug → nothing to render or key
  // index keeps the render key unique when a video repeats within one collection
  // (coreId alone would collide → dropped FlatList item + wrong recyclingKey).
  const id = `${cardCoreId}-${index}`
  const label = item.labelOverride ?? ""
  // Under-curated items (prod "Acts of the Apostles") carry a coreId but no
  // authored title/image; hydrate both from the linked video so they read like
  // every other card. Authored overrides always win — working shelves unchanged.
  const hydrated = item.coreId ? videoByCoreId.get(item.coreId) : undefined
  const hydratedTitle = hydrated?.locales?.[0]?.title ?? null
  const hydratedImage = hydrated ? pickAdminImage(hydrated.images ?? []) : null
  // Never blank: titleOverride, else labelOverride, else the linked video's
  // title, else the slug.
  const title =
    item.titleOverride || item.labelOverride || hydratedTitle || slug
  // collectionSize is a free-text String badge (e.g. "25 items"); blank/whitespace
  // reads as absent (trimmed), then falls to the label, else no badge.
  const size = item.collectionSize?.trim() || null
  const metaLabel = size ?? (label !== "" ? label : null)
  // Curated seed → inline image → linked-video art → the item's mux thumbnail
  // (last resort when hydration is unavailable) → none.
  const imageUrl =
    rewriteSeedPosterUrl(item.imageOverrideUrl) ??
    item.imageUrl ??
    hydratedImage ??
    muxThumbnailFromPlaybackId(item.muxPlaybackId) ??
    null
  return {
    id,
    sourceId,
    coreId: cardCoreId,
    slug,
    title,
    description: item.subtitleOverride ?? null,
    label,
    metaLabel,
    imageUrl,
    imageAlt: title,
    playbackId: null,
    durationSeconds: null,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
  }
}

function blockToSection(
  block: ExperienceBlock,
  index: number,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
): WatchHomeSection | null {
  const b = block as Record<string, unknown>
  const sectionKey = (b.sectionKey as string | null) ?? null
  const rawItems = (b.items as ExperienceItem[] | null | undefined) ?? []
  const cards = rawItems
    .map((item, i) =>
      itemToCard(item, sectionKey ?? "home-experience", i, videoByCoreId),
    )
    .filter((c): c is WatchHomeCard => c != null)
  if (cards.length === 0) return null // empty / all-dropped collection → skip

  const blockTitle = (b.title as string | null) ?? ""
  const categoryLabel = (b.categoryLabel as string | null) ?? ""
  const { layout, orientation } = mapVariant(
    b.mediaCollectionVariant as string | null,
  )
  const legacyOrientation = isPortraitPosterRail(rawItems)
    ? "vertical"
    : orientation
  return {
    // index disambiguates the FlashList key when a block omits sectionKey — the
    // fallback would otherwise collapse to one constant for every such block.
    id: sectionKey ?? `home-experience-section-${index}`,
    eyebrow: categoryLabel,
    // Empty admin title falls back to the category label so a shelf is never headless.
    title: blockTitle || categoryLabel,
    description: (b.subtitle as string | null) ?? null,
    layout,
    orientation: resolveMediaCollectionCardOrientation(
      b.cardOrientation,
      legacyOrientation,
    ),
    showSequenceNumbers: (b.showItemNumbers as boolean | null) ?? false,
    cards,
  }
}

export function buildWatchHomeSectionsFromExperience(
  blocks: readonly ExperienceBlock[] | null | undefined,
  // Hydration index from the merged bulk fetch. Defaults empty so a caller with
  // no video data (and the existing tests) renders inline-only, as before.
  videoByCoreId: Map<string, WatchHomeVideoInput> = new Map(),
): WatchHomeSection[] {
  const sections: WatchHomeSection[] = []
  ;(blocks ?? []).forEach((block, index) => {
    const typename = block.__typename
    if (typename === "MediaCollectionBlock") {
      const section = blockToSection(block, index, videoByCoreId)
      if (section) sections.push(section)
    } else if (typename === "WatchHomeHeroBlock") {
      // Expected placeholder — the hero stays client-owned; render nothing.
    } else if (__DEV__) {
      console.warn(`[WatchHomeAdapter] skipped block type: ${typename}`)
    }
  })
  return sections
}

/**
 * The unique, validated coreIds referenced by the Experience's MediaCollection
 * items — the input to the divergence check (`these − the hydration index`) that
 * decides which videos the top-up fetch must pull. Dedupes and drops unsafe ids.
 */
export function experienceItemCoreIds(
  blocks: readonly ExperienceBlock[] | null | undefined,
): string[] {
  const ids: string[] = []
  ;(blocks ?? []).forEach((block) => {
    if (block.__typename !== "MediaCollectionBlock") return
    const b = block as Record<string, unknown>
    const items = (b.items as ExperienceItem[] | null | undefined) ?? []
    for (const item of items) {
      if (isValidCoreId(item.coreId)) ids.push(item.coreId)
    }
  })
  return [...new Set(ids)]
}

/**
 * Body `sections` come from the Experience when it yields ≥1 shelf, else the
 * config model. The hero `carousel` is always config-sourced (spread from
 * `configModel`) — the split is at assembly; the hero fetch is untouched (KTD3, R4).
 */
export function resolveWatchHomeModel(args: {
  configModel: WatchHomeModel
  experienceSections: WatchHomeSection[]
}): { model: WatchHomeModel; usedExperience: boolean } {
  if (args.experienceSections.length >= 1) {
    return {
      model: { ...args.configModel, sections: args.experienceSections },
      usedExperience: true,
    }
  }
  return { model: args.configModel, usedExperience: false }
}

/**
 * Assemble the full Home model from the two DISTINCT video sets. The invariant
 * this function EXISTS to enforce (feat-172): the config model — which owns the
 * client-owned hero and greedily scans its input for short films — is built from
 * `configVideos` ONLY, while the Experience cards hydrate off the MERGED index.
 * So a curated short film that arrives only as top-up hydration renders in the
 * Experience body but can NEVER leak into the hero. Keep the two args separate;
 * never pass merged videos as `configVideos`.
 */
export function assembleWatchHomeModel(args: {
  configVideos: readonly WatchHomeVideoInput[]
  hydrationVideos: readonly WatchHomeVideoInput[]
  blocks: readonly ExperienceBlock[] | null
  languageSlug?: string
}): { model: WatchHomeModel; usedExperience: boolean } {
  const configModel = buildWatchHomeModelFromVideos({
    videos: args.configVideos,
    languageSlug: args.languageSlug,
  })
  const videoByCoreId = buildVideoByCoreIdIndex([
    ...args.configVideos,
    ...args.hydrationVideos,
  ])
  const experienceSections = args.blocks
    ? buildWatchHomeSectionsFromExperience(args.blocks, videoByCoreId)
    : []
  return resolveWatchHomeModel({ configModel, experienceSections })
}
