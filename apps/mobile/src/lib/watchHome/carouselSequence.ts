/**
 * ADAPTED COPY of apps/web/src/lib/watch-home-carousel-sequence.ts (pure pieces; sync via ./config.ts).
 * Mobile uses caller-held state not browser storage (globals throw on Hermes); slides lack build-time `src` (KTD-2),
 * eligibility is poster + slug (KTD-4); `overlayForInsert` re-evaluates at display time. Pure TS only.
 */

import { muxHlsUrlFromPlaybackId } from "../muxThumbnail"
import type { WatchHomeMuxInsertConfig } from "./config"

// Kept for web-parity sync; unused by the mobile pager (advance is playToEnd/timer-driven).
export const WATCH_HOME_TV_ADVANCE_THRESHOLD = 95

/** Web's initial hero queue size (useWatchHomeTvCarousel builds 7 first). */
export const WATCH_HOME_HERO_QUEUE_TARGET = 7

export type WatchHomeVideoSlide = {
  kind: "video"
  id: string
  title: string
  description: string | null
  label: string
  slug: string | null
  parentSlug: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string
  playbackId: string | null
  durationSeconds: number | null
  poolId?: string
  poolIndex?: number
}

export type WatchHomeMuxSlide = {
  kind: "mux"
  id: string
  /** Source insert config; display code re-resolves time-correct copy via `muxSlideDisplayCopy(slide, now)`. */
  insert: WatchHomeMuxInsertConfig
  title: string
  description: string | null
  label: string
  collectionTitle: string | null
  action: { label: string; url: string } | null
  posterUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string
  src: string | null
  playbackId: string | null
  durationSeconds: number | null
  logo: boolean
  playbackIndex: number
  prefixTitleWithDate: boolean
}

export type WatchHomeSlide = WatchHomeVideoSlide | WatchHomeMuxSlide

export type WatchHomeCarouselPool = {
  id: string
  collectionIds: readonly string[]
  videos: readonly WatchHomeVideoSlide[]
}

export type WatchHomeCarouselSequenceData = {
  pools: readonly WatchHomeCarouselPool[]
  muxInserts: readonly WatchHomeMuxInsertConfig[]
}

export type WatchHomeMuxOverlayCopy = {
  label: string
  title: string
  collectionTitle: string | null
  description: string | null
  action: { label: string; url: string } | null
}

export function simpleHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash &= hash
  }
  return Math.abs(hash)
}

function businessDate(now: Date): string {
  return now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  })
}

export function getWatchHomeDeterministicOffset(
  poolId: string,
  videoCount: number,
  options: {
    now?: Date
    poolIndex?: number
    totalVideosLoaded?: number
  } = {},
): number {
  if (videoCount <= 0) return 0

  const now = options.now ?? new Date()
  let seed = `${businessDate(now)}${poolId}`

  if (options.poolIndex != null) {
    seed += `-cycle${Math.floor(options.poolIndex / 15)}`
  }
  if (options.totalVideosLoaded != null) {
    seed += `-prog${Math.floor(options.totalVideosLoaded / 10)}`
  }

  return simpleHash(seed) % videoCount
}

/** KTD-4 eligibility: a usable hero slide needs poster + slug; no build-time stream (HLS resolves lazily). */
export function isEligibleWatchHomeVideoSlide(
  slide: Pick<WatchHomeVideoSlide, "posterUrl" | "slug">,
): boolean {
  return Boolean(slide.posterUrl && slide.slug)
}

export type WatchHomeQueueBuildInput = {
  pools: readonly WatchHomeCarouselPool[]
  existingVideos?: readonly WatchHomeVideoSlide[]
  /** Caller-held in-memory played set (replaces web's persisted played ids). */
  playedIds?: ReadonlySet<string>
  startPoolIndex?: number
  targetVideoCount: number
  now?: Date
}

/**
 * Build a video queue by cycling the pools, skipping caller-marked-played slides.
 * No persisted exhaustion counters: an exhausted pool yields no candidates and the
 * loop moves on (bounded by maxAttempts).
 */
export function buildWatchHomeVideoQueue({
  existingVideos = [],
  now = new Date(),
  playedIds,
  pools,
  startPoolIndex = 0,
  targetVideoCount,
}: WatchHomeQueueBuildInput): {
  videos: WatchHomeVideoSlide[]
  nextPoolIndex: number
} {
  if (targetVideoCount <= existingVideos.length || pools.length === 0) {
    return { videos: [...existingVideos], nextPoolIndex: startPoolIndex }
  }

  const videos = [...existingVideos]
  const seen = new Set(videos.map((video) => video.id))
  const played = playedIds ?? new Set<string>()
  let poolIndex = Math.max(0, startPoolIndex)
  let attempts = 0
  const maxAttempts = Math.max(pools.length * 4, targetVideoCount * 6)

  while (videos.length < targetVideoCount && attempts < maxAttempts) {
    const pool = pools[poolIndex % pools.length]
    attempts += 1

    if (!pool) {
      poolIndex += 1
      continue
    }

    const candidates = pool.videos.filter(
      (video) =>
        isEligibleWatchHomeVideoSlide(video) &&
        !seen.has(video.id) &&
        !played.has(video.id),
    )

    if (candidates.length === 0) {
      poolIndex += 1
      continue
    }

    const offset = getWatchHomeDeterministicOffset(pool.id, candidates.length, {
      now,
      poolIndex,
      totalVideosLoaded: videos.length,
    })
    const candidate = candidates[offset]
    if (candidate) {
      videos.push({ ...candidate, poolId: pool.id, poolIndex })
      seen.add(candidate.id)
    }

    poolIndex += 1
  }

  return { videos, nextPoolIndex: poolIndex }
}

export function muxPosterUrl(playbackId: string, width = 1280): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&height=720&fit_mode=smartcrop`
}

export function formatWatchHomeDatePrefix(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(now)
}

function timeRangeMatches(start: number, end: number, hour: number): boolean {
  if (start === end) return true
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

function currentEasternHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/New_York",
  }).formatToParts(now)
  const hour = parts.find((part) => part.type === "hour")?.value
  return hour ? Number(hour) : now.getHours()
}

/**
 * Pick the time-correct overlay copy for an insert. Call at DISPLAY time with a
 * fresh `now` (Eastern-hour rule); the queue bakes copy only as an initial value.
 */
export function overlayForInsert(
  insert: WatchHomeMuxInsertConfig,
  now: Date,
): WatchHomeMuxOverlayCopy {
  const overlays = insert.conditionalOverlays ?? []
  const hour = currentEasternHour(now)
  const selected = overlays
    .filter((overlay) =>
      overlay.conditions.every((condition) =>
        condition.type === "time-range"
          ? timeRangeMatches(condition.range.start, condition.range.end, hour)
          : false,
      ),
    )
    .sort((a, b) => b.priority - a.priority)[0]

  if (!selected) {
    return {
      label: insert.label,
      title: insert.title,
      collectionTitle: insert.collectionTitle,
      description: insert.description,
      action: insert.action,
    }
  }

  return {
    label: selected.overlay.label,
    title: selected.overlay.title,
    collectionTitle: selected.overlay.collectionTitle,
    description: selected.overlay.description,
    action: selected.overlay.action ?? insert.action,
  }
}

/** Display-time copy for a mux slide: time-correct overlay plus the first sequence-start insert's date prefix. */
export function muxSlideDisplayCopy(
  slide: WatchHomeMuxSlide,
  now: Date,
): WatchHomeMuxOverlayCopy {
  const copy = overlayForInsert(slide.insert, now)
  if (!slide.prefixTitleWithDate) return copy
  return { ...copy, title: `${formatWatchHomeDatePrefix(now)}: ${copy.title}` }
}

/**
 * Deterministic playback-id selection per insert. Caller's `sessionSeed` (any
 * stable per-session string) gives the in-session stability web got from a persisted random pick.
 */
function selectMuxPlaybackId(
  insert: WatchHomeMuxInsertConfig,
  sessionSeed: string,
): {
  playbackId: string | null
  playbackIndex: number
} {
  const playbackIds = insert.playbackIds.filter(Boolean)
  if (playbackIds.length === 0) return { playbackId: null, playbackIndex: -1 }

  const index = simpleHash(`${sessionSeed}:${insert.id}`) % playbackIds.length
  const playbackId = playbackIds[index]
  if (!playbackId) return { playbackId: null, playbackIndex: -1 }

  return { playbackId, playbackIndex: index }
}

function muxInsertToSlide(
  insert: WatchHomeMuxInsertConfig,
  options: { now: Date; sessionSeed: string; prefixTitleWithDate?: boolean },
): WatchHomeMuxSlide | null {
  const { playbackId, playbackIndex } = selectMuxPlaybackId(
    insert,
    options.sessionSeed,
  )
  if (!playbackId) return null

  const overlay = overlayForInsert(insert, options.now)
  const title = options.prefixTitleWithDate
    ? `${formatWatchHomeDatePrefix(options.now)}: ${overlay.title}`
    : overlay.title
  const posterUrl = insert.posterOverride ?? muxPosterUrl(playbackId)

  return {
    kind: "mux",
    id: `mux-${insert.id}`,
    insert,
    title,
    description: overlay.description,
    label: overlay.label,
    collectionTitle: overlay.collectionTitle,
    action: overlay.action,
    posterUrl,
    thumbnailUrl: muxPosterUrl(playbackId, 640),
    imageAlt: title,
    // muxHlsUrlFromPlaybackId additionally guards for a clean alphanumeric
    // token; a tainted playback id yields src: null (no consumer plays mux
    // src today — slides advance on the image timer).
    src: muxHlsUrlFromPlaybackId(playbackId),
    playbackId,
    durationSeconds: insert.durationSeconds,
    logo: insert.logo,
    playbackIndex,
    prefixTitleWithDate: options.prefixTitleWithDate ?? false,
  }
}

export const WATCH_HOME_DEFAULT_SESSION_SEED = "watch-home"

export function mergeWatchHomeMuxInserts(
  videos: readonly WatchHomeVideoSlide[],
  inserts: readonly WatchHomeMuxInsertConfig[],
  now = new Date(),
  sessionSeed = WATCH_HOME_DEFAULT_SESSION_SEED,
): WatchHomeSlide[] {
  const enabled = inserts.filter((insert) => insert.enabled)
  if (enabled.length === 0) return [...videos]

  const sequenceStart = enabled.filter(
    (insert) => insert.trigger.type === "sequence-start",
  )
  const afterCount = enabled.filter(
    (
      insert,
    ): insert is WatchHomeMuxInsertConfig & {
      trigger: { type: "after-count"; count: number }
    } => insert.trigger.type === "after-count",
  )
  const inserted = new Set<string>()
  const slides: WatchHomeSlide[] = []
  const firstStartId = sequenceStart[0]?.id

  for (const insert of sequenceStart) {
    const slide = muxInsertToSlide(insert, {
      now,
      sessionSeed,
      prefixTitleWithDate: insert.id === firstStartId,
    })
    if (slide) {
      slides.push(slide)
      inserted.add(insert.id)
    }
  }

  videos.forEach((video, index) => {
    slides.push(video)

    for (const insert of afterCount) {
      if (inserted.has(insert.id)) continue
      if (index + 1 < insert.trigger.count) continue
      const slide = muxInsertToSlide(insert, { now, sessionSeed })
      if (slide) {
        slides.push(slide)
        inserted.add(insert.id)
      }
    }
  })

  return slides
}

export type WatchHomeHeroQueueInput = {
  pools: readonly WatchHomeCarouselPool[]
  inserts: readonly WatchHomeMuxInsertConfig[]
  /** Caller-held in-memory played set; cleared by the caller on `wrapped`. */
  playedIds?: ReadonlySet<string>
  targetVideoCount?: number
  startPoolIndex?: number
  now?: Date
  sessionSeed?: string
}

/**
 * Build the full hero queue: video queue from the pools, then mux inserts merged at
 * their triggers. When all eligible slides are played, it rebuilds ignoring the played
 * set and returns `wrapped: true` so the caller can reset its set.
 */
export function buildWatchHomeHeroQueue({
  pools,
  inserts,
  playedIds,
  targetVideoCount = WATCH_HOME_HERO_QUEUE_TARGET,
  startPoolIndex = 0,
  now = new Date(),
  sessionSeed = WATCH_HOME_DEFAULT_SESSION_SEED,
}: WatchHomeHeroQueueInput): {
  slides: WatchHomeSlide[]
  videos: WatchHomeVideoSlide[]
  wrapped: boolean
} {
  let result = buildWatchHomeVideoQueue({
    pools,
    playedIds,
    startPoolIndex,
    targetVideoCount,
    now,
  })
  let wrapped = false

  if (result.videos.length === 0 && (playedIds?.size ?? 0) > 0) {
    wrapped = true
    result = buildWatchHomeVideoQueue({
      pools,
      startPoolIndex,
      targetVideoCount,
      now,
    })
  }

  return {
    slides: mergeWatchHomeMuxInserts(result.videos, inserts, now, sessionSeed),
    videos: result.videos,
    wrapped,
  }
}
