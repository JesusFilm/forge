// SDUI MediaCollection cards can carry authored item images, but otherwise TV
// resolves title/image from the linked video, hydrated by coreId.

import { pickCardImage, type CardImageSource } from "./cardImage"
import { resolveVideoDisplayTitle } from "@forge/content-display"
import { resolveImageUrl } from "./resolveImageUrl"
import type { NormalizedBlock } from "./normalizer"
import { blockImageAssetPreviewUrl } from "./blockImageAsset"

// The subset of a hydrated video the card needs (structural, so it accepts the
// gql.tada result without coupling to the generated type).
export type HydratedVideo = {
  coreId?: string | null
  slug?: string | null
  images?: readonly CardImageSource[] | null
  locales?: readonly { title?: string | null }[] | null
}

// KTD10 parity: coreIds ride as a $coreIds variable, but validate before use.
const CORE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

function isValidCoreId(coreId: string | null | undefined): coreId is string {
  return typeof coreId === "string" && CORE_ID_PATTERN.test(coreId)
}

export function buildVideoByCoreId(
  videos: readonly HydratedVideo[] | null | undefined,
): Map<string, HydratedVideo> {
  const map = new Map<string, HydratedVideo>()
  for (const video of videos ?? []) {
    if (isValidCoreId(video?.coreId)) map.set(video.coreId, video)
  }
  return map
}

// Recurse the normalized tree (sections → sectionWrapper.sectionContent →
// container.slots.slotContent) for every MediaCollection item's coreId, deduped.
export function collectMediaCollectionCoreIds(
  blocks: readonly NormalizedBlock[] | null | undefined,
): string[] {
  const ids: string[] = []
  const walk = (list: readonly NormalizedBlock[] | null | undefined) => {
    for (const block of list ?? []) {
      if (block.kind === "mediaCollection") {
        for (const item of block.items ?? []) {
          if (isValidCoreId(item?.coreId)) ids.push(item.coreId)
        }
      } else if (block.kind === "sectionWrapper") {
        walk(block.sectionContent)
      } else if (block.kind === "container") {
        for (const slot of block.slots ?? []) walk(slot.slotContent)
      }
    }
  }
  walk(blocks)
  return [...new Set(ids)]
}

type MediaItemLike = {
  coreId?: string | null
  titleOverride?: string | null
  imageAsset?: unknown
  imageUrl?: unknown
}

function firstNonEmpty(
  ...values: (string | null | undefined)[]
): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value
  }
  return null
}

// Authored `titleOverride` wins; else the hydrated video's localized title (then
// slug), else "Untitled". Empty-string overrides fall through (admin clears to "").
export function resolveMediaItemTitle(
  item: MediaItemLike,
  video: HydratedVideo | undefined,
): string {
  return (
    resolveVideoDisplayTitle({
      requestedTitles: [
        item.titleOverride,
        ...(video?.locales?.map((locale) => locale.title) ?? []),
      ],
      slug: video?.slug,
    }) ?? "Untitled"
  )
}

export function resolveMediaItemImageUrl(
  item: MediaItemLike,
  video: HydratedVideo | undefined,
): string | null {
  return (
    resolveImageUrl(blockImageAssetPreviewUrl(item.imageAsset)) ??
    resolveImageUrl(
      typeof item.imageUrl === "string" ? firstNonEmpty(item.imageUrl) : null,
    ) ??
    resolveImageUrl(pickCardImage(video?.images ?? null, "card"))
  )
}
