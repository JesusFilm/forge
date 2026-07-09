// Maps the admin `watch-home` Experience's MediaCollectionBlocks into TV's
// existing WatchHomeSection[] so HomeRail/HomeCard render unchanged (R2, R3).
//
// TV DIVERGES from mobile's adapter: mobile renders the flat Experience items
// directly (childCount 0, no rawLabel, and — in prod — a null videoSlug it can't
// even navigate). TV instead joins each item to a hydrated video record by coreId
// and builds the card through model.ts's normalizeCard, so meta chips are exact
// ("N episodes" / duration) and series-vs-single routing is precise (R3, R5).

import { ENGLISH_LANGUAGE_SLUG } from "./config"
import {
  normalizeCard,
  type WatchHomeCard,
  type WatchHomeSection,
  type WatchHomeVideoInput,
} from "./model"

// Loose structural shapes so the adapter accepts BOTH live gql.tada blocks and
// snapshot-deserialized JSON blocks (the reason mobile reads blocks dynamically).
export type ExperienceBlock = { readonly __typename?: string | null }

type ExperienceItem = { readonly coreId?: string | null }

type MediaCollectionBlockLike = {
  readonly __typename?: string | null
  readonly sectionKey?: string | null
  readonly title?: string | null
  readonly subtitle?: string | null
  readonly categoryLabel?: string | null
  readonly mediaCollectionVariant?: string | null
  readonly showItemNumbers?: boolean | null
  readonly items?: readonly ExperienceItem[] | null
}

type LayoutShape = {
  layout: WatchHomeSection["layout"]
  orientation: WatchHomeSection["orientation"]
}

// KTD10: Experience coreIds ride as a $coreIds variable (not string-spliced), but
// validate before joining them into the hydration union anyway.
const CORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
function isValidCoreId(coreId: string | null | undefined): coreId is string {
  return typeof coreId === "string" && CORE_ID_PATTERN.test(coreId)
}

// KTD7: block types with no TV rail slot. WatchHomeHeroBlock (client-owned banner),
// SectionBlock (mission tail), and promo/CTA are expected in the prod Experience and
// skipped silently; only a genuinely unrecognized __typename dev-warns (R6/AE6).
const SILENT_SKIP_BLOCKS = new Set([
  "WatchHomeHeroBlock",
  "SectionBlock",
  "PromoBannerBlock",
  "CtaBlock",
])

// KTD2: carousel → horizontal rail, collection → vertical grid, grid/default →
// horizontal grid. TV renders every section as a rail today; layout/orientation are
// sync-parity fields carried on the model.
export function mapVariant(variant: string | null | undefined): LayoutShape {
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
  sectionId: string,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
  languageSlug: string,
): WatchHomeCard | null {
  const coreId = item.coreId
  if (!isValidCoreId(coreId)) return null
  const video = videoByCoreId.get(coreId)
  if (!video) return null // per-item drop: the coreId did not hydrate (R3)
  return normalizeCard({ sectionId, sourceId: coreId, video, languageSlug })
}

function blockToSection(
  block: MediaCollectionBlockLike,
  index: number,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
  languageSlug: string,
): WatchHomeSection | null {
  const sectionId = block.sectionKey ?? `home-experience-section-${index}`
  const cards = (block.items ?? [])
    .map((item) => itemToCard(item, sectionId, videoByCoreId, languageSlug))
    .filter((card): card is WatchHomeCard => card != null)
  if (cards.length === 0) return null // per-section skip: zero renderable cards (R2)

  const categoryLabel = block.categoryLabel ?? ""
  const blockTitle = block.title ?? ""
  const { layout, orientation } = mapVariant(block.mediaCollectionVariant)
  return {
    id: sectionId,
    eyebrow: categoryLabel,
    title: blockTitle || categoryLabel, // never a headless rail
    description: block.subtitle ?? null,
    layout,
    orientation,
    showSequenceNumbers: block.showItemNumbers ?? false,
    cards,
  }
}

/**
 * Build TV rails from the Experience blocks, hydrating each item by coreId through
 * the merged `videoByCoreId` index. Per-item drop on no-hydrate; per-section skip on
 * zero cards; known non-rail blocks skip silently; unknown blocks dev-warn (R2/R3/R6).
 */
export function buildWatchHomeSectionsFromExperience(
  blocks: readonly ExperienceBlock[] | null | undefined,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
  languageSlug: string = ENGLISH_LANGUAGE_SLUG,
): WatchHomeSection[] {
  const sections: WatchHomeSection[] = []
  ;(blocks ?? []).forEach((block, index) => {
    const typename = block.__typename
    if (typename === "MediaCollectionBlock") {
      const section = blockToSection(
        block as MediaCollectionBlockLike,
        index,
        videoByCoreId,
        languageSlug,
      )
      if (section) sections.push(section)
    } else if (typename != null && SILENT_SKIP_BLOCKS.has(typename)) {
      // Known non-rail block — skip silently (no warning).
    } else if (__DEV__) {
      console.warn(`[WatchHomeAdapter] skipped block type: ${typename}`)
    }
  })
  return sections
}
