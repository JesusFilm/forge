/**
 * Maps the published `watch-home` homepage Experience's flat MediaCollectionBlock
 * items into the existing WatchHomeSection[] shape so HomeScreen / HomeShelf
 * render unchanged. Lean cards — no per-item video resolution — matching web's
 * home renderer (title from `titleOverride`, `collectionSize` verbatim badge, no
 * duration). Non-collection blocks are skipped: `WatchHomeHeroBlock` is an
 * expected placeholder (silent); anything else logs a dev warning, mirroring
 * `SectionDispatcher`.
 */
import type { WatchHomeCard, WatchHomeSection } from "./model"

type ExperienceBlock = { readonly __typename?: string | null } & Record<
  string,
  unknown
>

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
): WatchHomeCard | null {
  const slug = item.videoSlug
  if (!slug) return null // no slug → the card can't navigate; drop it
  const id = item.videoId ?? slug
  const label = item.labelOverride ?? ""
  // Never blank: titleOverride, else labelOverride, else the slug.
  const title = item.titleOverride || item.labelOverride || slug
  // collectionSize is a free-text String badge (e.g. "25 items"), not a count —
  // render it verbatim, else fall to the label, else show no badge.
  const metaLabel = item.collectionSize ?? (label !== "" ? label : null)
  return {
    id,
    sourceId,
    coreId: id,
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

function blockToSection(block: ExperienceBlock): WatchHomeSection | null {
  const sectionKey = (block.sectionKey as string | null) ?? null
  const rawItems = (block.items as ExperienceItem[] | null | undefined) ?? []
  const cards = rawItems
    .map((item) => itemToCard(item, sectionKey ?? "home-experience"))
    .filter((c): c is WatchHomeCard => c != null)
  if (cards.length === 0) return null // empty / all-dropped collection → skip

  const blockTitle = (block.title as string | null) ?? ""
  const categoryLabel = (block.categoryLabel as string | null) ?? ""
  const { layout, orientation } = mapVariant(
    block.mediaCollectionVariant as string | null,
  )
  return {
    id: sectionKey ?? (blockTitle || "home-experience-section"),
    eyebrow: categoryLabel,
    // Empty admin title falls back to the category label so a shelf is never headless.
    title: blockTitle || categoryLabel,
    description: (block.subtitle as string | null) ?? null,
    layout,
    orientation,
    showSequenceNumbers: (block.showItemNumbers as boolean | null) ?? false,
    cards,
  }
}

export function buildWatchHomeSectionsFromExperience(
  blocks: readonly ExperienceBlock[] | null | undefined,
): WatchHomeSection[] {
  const sections: WatchHomeSection[] = []
  for (const block of blocks ?? []) {
    const typename = block.__typename
    if (typename === "MediaCollectionBlock") {
      const section = blockToSection(block)
      if (section) sections.push(section)
    } else if (typename === "WatchHomeHeroBlock") {
      // Expected placeholder — the hero stays client-owned; render nothing.
      continue
    } else if (__DEV__) {
      console.warn(`[WatchHomeAdapter] skipped block type: ${typename}`)
    }
  }
  return sections
}
