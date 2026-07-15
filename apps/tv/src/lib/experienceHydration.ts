// SDUI MediaCollection cards carry no usable title/image (authored overrides are
// null; imageOverrideUrl 404s). Like the Home rail — and diverging from mobile's
// flat render — TV resolves both from the linked video, hydrated by coreId.

import { pickCardImage, type CardImageSource } from "./cardImage"
import { resolveImageUrl } from "./resolveImageUrl"
import type { NormalizedBlock } from "./normalizer"

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
  imageUrl?: string | null
  imageOverrideUrl?: string | null
}

// The watch web app origin serving its bundled poster assets. Absolute (not TV's
// relative static base) so posters load in dev builds too — the relative path
// resolves to a non-running localhost web server there. Prod-pinned across envs.
const WATCH_ASSET_BASE = "https://watch.jesusfilm.org/watch"

// SYNC: mirrors apps/web/src/lib/media-image-url.ts. Rewrites a jesusfilm.org
// /images seed URL to the watch app origin (the SAME curated poster web renders);
// any other URL passes through unchanged.
function rewriteSeedPosterUrl(url: string | null): string | null {
  if (!url) return null
  const match = url.match(
    /^https?:\/\/(?:www\.)?jesusfilm\.org(\/images\/.*)$/i,
  )
  return match?.[1] ? `${WATCH_ASSET_BASE}${match[1]}` : url
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
    firstNonEmpty(
      item.titleOverride,
      video?.locales?.[0]?.title,
      video?.slug,
    ) ?? "Untitled"
  )
}

/**
 * The authored override poster alone (curated vertical art), or null. Exported
 * because the Home adapter needs THIS branch by itself: it is BOTH the signal
 * that a rail is portrait and the art those cards show, so one function decides
 * both and they cannot disagree. `imageUrl` must NOT count toward it — that
 * field carries landscape art too.
 */
export function resolveOverridePosterUrl(item: MediaItemLike): string | null {
  return resolveImageUrl(
    rewriteSeedPosterUrl(firstNonEmpty(item.imageOverrideUrl)),
  )
}

// The curated override poster wins (web's precedence: imageOverrideUrl →
// imageUrl → video art), so these cards show the SAME portrait posters web
// renders instead of the video's landscape cinematic cropped to portrait.
export function resolveMediaItemImageUrl(
  item: MediaItemLike,
  video: HydratedVideo | undefined,
): string | null {
  return (
    resolveOverridePosterUrl(item) ??
    resolveImageUrl(firstNonEmpty(item.imageUrl)) ??
    resolveImageUrl(pickCardImage(video?.images ?? null, "card"))
  )
}
