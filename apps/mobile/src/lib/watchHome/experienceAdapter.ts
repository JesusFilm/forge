/**
 * Maps the `watch-home` Experience's flat MediaCollectionBlock items into the
 * existing WatchHomeSection[] shape (lean cards, matching web) so HomeShelf
 * renders unchanged. Non-collection blocks are skipped (hero is a silent placeholder).
 */
import type { WatchHomeCard, WatchHomeModel, WatchHomeSection } from "./model"

// Structural block shape — the precise gql.tada block unions assign to this;
// field access happens via a Record cast inside blockToSection.
type ExperienceBlock = { readonly __typename?: string | null }

type ExperienceItem = {
  videoId?: string | null
  videoSlug?: string | null
  titleOverride?: string | null
  subtitleOverride?: string | null
  labelOverride?: string | null
  collectionSize?: string | null
  imageUrl?: string | null
  imageOverrideUrl?: string | null
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

function itemToCard(
  item: ExperienceItem,
  sourceId: string,
  index: number,
): WatchHomeCard | null {
  // Match web's enrichment: curated home items carry videoId but a null
  // videoSlug, so keep the card (image + title) with an empty slug — HomeCard
  // skips navigation on an empty slug rather than dropping the card.
  const slug = item.videoSlug ?? ""
  const coreId = item.videoId ?? slug
  if (!coreId) return null // no id and no slug → nothing to render or key
  // index keeps the render key unique when a video repeats within one collection
  // (coreId alone would collide → dropped FlatList item + wrong recyclingKey).
  const id = `${coreId}-${index}`
  const label = item.labelOverride ?? ""
  // Never blank: titleOverride, else labelOverride, else the slug.
  const title = item.titleOverride || item.labelOverride || slug
  // collectionSize is a free-text String badge (e.g. "25 items"); blank/whitespace
  // reads as absent, then falls to the label, else no badge.
  const size = item.collectionSize?.trim() ? item.collectionSize : null
  const metaLabel = size ?? (label !== "" ? label : null)
  return {
    id,
    sourceId,
    coreId,
    slug,
    title,
    description: item.subtitleOverride ?? null,
    label,
    metaLabel,
    imageUrl: item.imageOverrideUrl ?? item.imageUrl ?? null,
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
): WatchHomeSection | null {
  const b = block as Record<string, unknown>
  const sectionKey = (b.sectionKey as string | null) ?? null
  const rawItems = (b.items as ExperienceItem[] | null | undefined) ?? []
  const cards = rawItems
    .map((item, i) => itemToCard(item, sectionKey ?? "home-experience", i))
    .filter((c): c is WatchHomeCard => c != null)
  if (cards.length === 0) return null // empty / all-dropped collection → skip

  const blockTitle = (b.title as string | null) ?? ""
  const categoryLabel = (b.categoryLabel as string | null) ?? ""
  const { layout, orientation } = mapVariant(
    b.mediaCollectionVariant as string | null,
  )
  return {
    // index disambiguates the FlashList key when a block omits sectionKey — the
    // fallback would otherwise collapse to one constant for every such block.
    id: sectionKey ?? `home-experience-section-${index}`,
    eyebrow: categoryLabel,
    // Empty admin title falls back to the category label so a shelf is never headless.
    title: blockTitle || categoryLabel,
    description: (b.subtitle as string | null) ?? null,
    layout,
    orientation,
    showSequenceNumbers: (b.showItemNumbers as boolean | null) ?? false,
    cards,
  }
}

export function buildWatchHomeSectionsFromExperience(
  blocks: readonly ExperienceBlock[] | null | undefined,
): WatchHomeSection[] {
  const sections: WatchHomeSection[] = []
  ;(blocks ?? []).forEach((block, index) => {
    const typename = block.__typename
    if (typename === "MediaCollectionBlock") {
      const section = blockToSection(block, index)
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
