// Maps the admin watch-home Experience's MediaCollectionBlocks into TV rails,
// hydrating each item by coreId through model.ts's normalizeCard — so meta chips
// and series routing are exact (TV DIVERGES from mobile's flat, unhydrated render).

import {
  resolveCuratedItemImageUrl,
  resolveOverridePosterUrl,
} from "../experienceHydration"
import { ENGLISH_LANGUAGE_SLUG } from "./config"
import type { WatchHomeFallbackReason } from "./logWatchHomeFallback"
import {
  normalizeCard,
  type WatchHomeCard,
  type WatchHomeModel,
  type WatchHomeSection,
  type WatchHomeVideoInput,
} from "./model"

// Loose structural shapes so the adapter accepts BOTH live gql.tada blocks and
// snapshot-deserialized JSON blocks (the reason mobile reads blocks dynamically).
export type ExperienceBlock = { readonly __typename?: string | null }

type ExperienceItem = {
  readonly coreId?: string | null
  // Threaded onto the card for the animated hover-preview (U5); already on the wire.
  readonly muxPlaybackId?: string | null
  // Authored art. Already on the wire via the SHARED AdminMediaCollection
  // fragment — TV simply ignored it until portrait rails needed the poster.
  readonly imageOverrideUrl?: string | null
  readonly imageUrl?: string | null
}

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

/**
 * A rail is PORTRAIT when every item resolves an override poster — those
 * overrides are the curated vertical art a 2.13:1 card would crop to a sliver.
 * Mirrors mobile's isPortraitPosterRail, with one deliberate tightening: mobile
 * tests the raw field, we test the RESOLVED url, so an unusable override can
 * never hand a portrait frame to the landscape fallback art.
 * `imageUrl` deliberately does NOT count — it carries landscape art too.
 */
function isPortraitPosterRail(items: readonly ExperienceItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => resolveOverridePosterUrl(item) != null)
  )
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
  return normalizeCard({
    sectionId,
    sourceId: coreId,
    video,
    languageSlug,
    muxPlaybackId: item.muxPlaybackId ?? null,
    // Web's precedence (imageOverrideUrl → imageUrl → video art): the curated
    // poster outranks the hydrated cinematic, so a portrait rail shows the
    // portrait art rather than a centre-cropped landscape still.
    imageUrlOverride: resolveCuratedItemImageUrl(item),
  })
}

function blockToSection(
  block: MediaCollectionBlockLike,
  index: number,
  videoByCoreId: Map<string, WatchHomeVideoInput>,
  languageSlug: string,
): WatchHomeSection | null {
  const sectionId = block.sectionKey ?? `home-experience-section-${index}`
  const rawItems = block.items ?? []
  const cards = rawItems
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
    // Poster rails override the variant's orientation: `carousel` maps to
    // horizontal, yet prod's "Discover the full story" is an all-poster
    // carousel that web renders portrait. Tested against rawItems, not cards —
    // a dropped item must not turn a mixed rail portrait.
    orientation: isPortraitPosterRail(rawItems) ? "vertical" : orientation,
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

/**
 * The unique, validated coreIds referenced by the Experience's MediaCollection
 * items — the input to KTD3's divergence check (`these − the hydration index`).
 * Dedupes and drops KTD10-unsafe ids before they reach the top-up union.
 */
export function experienceItemCoreIds(
  blocks: readonly ExperienceBlock[] | null | undefined,
): string[] {
  const ids: string[] = []
  ;(blocks ?? []).forEach((block) => {
    if (block.__typename !== "MediaCollectionBlock") return
    for (const item of (block as MediaCollectionBlockLike).items ?? []) {
      if (isValidCoreId(item.coreId)) ids.push(item.coreId)
    }
  })
  return [...new Set(ids)]
}

/**
 * Choose the Home body: the Experience wins when it yields >=1 renderable rail,
 * overriding ONLY `sections` so the featured banner stays config-sourced (R7).
 * Zero rails → the config model unchanged, so the code-curated rows render (R8).
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

// How the primary config-pool videos fetch resolved. A non-ok primary can't
// hydrate anything (hero or fallback rows), so it routes to the retry state.
export type PrimaryVideosState =
  | { kind: "ok"; configModel: WatchHomeModel }
  | { kind: "rejected" } // fetch threw → retry-with-focus (R10/AE10)
  | { kind: "empty-over-snapshot" } // empty-but-successful over good content → retry

// How the watchSetting Experience fetch resolved: live blocks, fulfilled-but-absent
// (null homepage), or rejected (threw / timed out).
export type ExperienceOutcomeKind = "present" | "absent" | "error"

export type WatchHomeReconcileInput = {
  primary: PrimaryVideosState
  experienceSections: WatchHomeSection[]
  experienceOutcome: ExperienceOutcomeKind
  // The blocks that produced experienceSections (live, or the reused last-good) —
  // stored as the next last-good when the Experience is used.
  experienceBlocks: readonly ExperienceBlock[] | null
  topUpFailed: boolean
}

export type WatchHomeReconcileOutput =
  | { kind: "error" }
  | {
      kind: "model"
      model: WatchHomeModel
      usedExperience: boolean
      // The fallback reasons to emit (0..2): a config fallback OR error-recovered,
      // plus topup-error when a divergent top-up was dropped.
      logs: WatchHomeFallbackReason[]
      // The blocks to remember as last-good, or undefined to leave it unchanged.
      nextLastGoodBlocks: readonly ExperienceBlock[] | null | undefined
    }

/**
 * The R8/R9/R10 resilience decision as a pure function, so the hook stays impure-only
 * and this stays unit-testable. Maps the primary + experience result to the Home body
 * and the fallback reasons to log (see WatchHomeReconcileInput/Output for the branches).
 */
export function reconcileWatchHome(
  input: WatchHomeReconcileInput,
): WatchHomeReconcileOutput {
  if (input.primary.kind !== "ok") return { kind: "error" }

  const { model, usedExperience } = resolveWatchHomeModel({
    configModel: input.primary.configModel,
    experienceSections: input.experienceSections,
  })

  const logs: WatchHomeFallbackReason[] = []
  let nextLastGoodBlocks: readonly ExperienceBlock[] | null | undefined
  if (usedExperience) {
    nextLastGoodBlocks = input.experienceBlocks
    if (input.experienceOutcome === "error") logs.push("error-recovered")
  } else {
    // A definitive fulfilled-absent homepage invalidates any stale last-good, so a
    // later transient error can't resurrect a removed homepage (R9); error/empty give
    // no fresh authoritative signal, so leave last-good unchanged.
    if (input.experienceOutcome === "absent") nextLastGoodBlocks = null
    logs.push(
      input.experienceOutcome === "error"
        ? "error"
        : input.experienceOutcome === "absent"
          ? "null"
          : "empty",
    )
  }
  if (input.topUpFailed) logs.push("topup-error")

  return { kind: "model", model, usedExperience, logs, nextLastGoodBlocks }
}
