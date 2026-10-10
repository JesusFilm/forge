import { resolveMuxHeroPosterUrlAtMaxWidth } from "@/lib/url"
import type {
  WatchHomeCarouselPool,
  WatchHomeCarouselSequenceData,
  WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"

/**
 * The home hero's rotation pools cross the server/client boundary as props of
 * a client component, so every byte of them is inlined into the cached HTML as
 * RSC flight data and replayed on the main thread before hydration. Measured on
 * production /watch on 2026-10-08, the pools were 142,569 of the page's 358,583
 * flight bytes (218 videos), and most of each entry repeated a value the client
 * can rebuild exactly: the Mux stream and poster URLs from `playbackId`, the
 * alt text from `title`, and the authored thumbnail from `id`.
 *
 * The encoding is lossless BY CONSTRUCTION: a field is dropped only when it is
 * byte-identical to what `decodeWatchHomeCarouselSequence` will rebuild, so any
 * entry that does not match the derivation (a non-Mux stream, a blank alt, an
 * authored thumbnail on another path) keeps its own value. A `null` is kept as
 * `null`; only an ABSENT key means "derive".
 */

const DERIVED_FIELDS = ["src", "posterUrl", "imageAlt", "thumbnailUrl"] as const

type DerivedField = (typeof DERIVED_FIELDS)[number]

export type WatchHomeCarouselWireVideo = Omit<
  WatchHomeTvCarouselVideoSlide,
  DerivedField
> &
  Partial<Pick<WatchHomeTvCarouselVideoSlide, DerivedField>>

/**
 * `thumbnailUrl` is authored admin artwork, so its shape is data, not a rule
 * this app owns. The template is therefore learned from the pools themselves
 * (the most common `prefix + id + suffix` split) and sent once per sequence,
 * rather than hard-coding an image-CDN account path into the client.
 */
export type WatchHomeCarouselThumbnailTemplate = {
  prefix: string
  suffix: string
}

export type WatchHomeCarouselSequenceWire = {
  pools: ReadonlyArray<
    Omit<WatchHomeCarouselPool, "videos"> & {
      videos: readonly WatchHomeCarouselWireVideo[]
    }
  >
  thumbnailTemplate?: WatchHomeCarouselThumbnailTemplate
}

function muxStreamUrl(playbackId: string | null): string | null {
  return playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null
}

function templatedThumbnailUrl(
  template: WatchHomeCarouselThumbnailTemplate | undefined,
  id: string,
): string | null {
  return template ? `${template.prefix}${id}${template.suffix}` : null
}

function derivedValue(
  field: DerivedField,
  video: Pick<WatchHomeTvCarouselVideoSlide, "id" | "playbackId" | "title">,
  template: WatchHomeCarouselThumbnailTemplate | undefined,
): string | null {
  switch (field) {
    case "src":
      return muxStreamUrl(video.playbackId)
    case "posterUrl":
      return resolveMuxHeroPosterUrlAtMaxWidth(video.playbackId)
    case "imageAlt":
      return video.title
    case "thumbnailUrl":
      return templatedThumbnailUrl(template, video.id)
  }
}

function learnThumbnailTemplate(
  pools: readonly WatchHomeCarouselPool[],
): WatchHomeCarouselThumbnailTemplate | undefined {
  const counts = new Map<
    string,
    { template: WatchHomeCarouselThumbnailTemplate; count: number }
  >()
  for (const pool of pools) {
    for (const video of pool.videos) {
      const url = video.thumbnailUrl
      if (!url || !video.id) continue
      const at = url.indexOf(video.id)
      if (at < 0) continue
      const template = {
        prefix: url.slice(0, at),
        suffix: url.slice(at + video.id.length),
      }
      const key = JSON.stringify(template)
      const entry = counts.get(key) ?? { template, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
  }
  let best: {
    template: WatchHomeCarouselThumbnailTemplate
    count: number
  } | null = null
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry
  }
  // A template only pays for itself once it replaces more than one URL.
  return best && best.count > 1 ? best.template : undefined
}

export function encodeWatchHomeCarouselSequence(
  sequence: WatchHomeCarouselSequenceData,
): WatchHomeCarouselSequenceWire {
  const thumbnailTemplate = learnThumbnailTemplate(sequence.pools)
  const pools = sequence.pools.map((pool) => ({
    ...pool,
    videos: pool.videos.map((video) => {
      const wire: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(video)) {
        const field = key as DerivedField
        if (
          (DERIVED_FIELDS as readonly string[]).includes(key) &&
          value === derivedValue(field, video, thumbnailTemplate)
        ) {
          // Omit the key entirely: an `undefined` value would still cross
          // the flight boundary as `"$undefined"`.
          continue
        }
        wire[key] = value
      }
      return wire as WatchHomeCarouselWireVideo
    }),
  }))
  return thumbnailTemplate ? { pools, thumbnailTemplate } : { pools }
}

/**
 * Accepts a full `WatchHomeCarouselSequenceData` too: every field present is
 * kept as-is, so an un-encoded sequence decodes to an equal value.
 */
export function decodeWatchHomeCarouselSequence(
  wire: WatchHomeCarouselSequenceWire,
): WatchHomeCarouselSequenceData {
  const template = wire.thumbnailTemplate
  return {
    pools: wire.pools.map((pool) => ({
      ...pool,
      videos: pool.videos.map((video) => {
        const decoded = { ...video } as WatchHomeTvCarouselVideoSlide
        for (const field of DERIVED_FIELDS) {
          if (video[field] === undefined) {
            ;(decoded as Record<DerivedField, string | null>)[field] =
              derivedValue(field, video, template)
          }
        }
        return decoded
      }),
    })),
  }
}
