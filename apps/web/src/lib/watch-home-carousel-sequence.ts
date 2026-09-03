export const WATCH_HOME_TV_ADVANCE_THRESHOLD = 95
export const WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY = "carousel-played-ids"
export const WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY = "carousel-current-video"
export const WATCH_HOME_TV_VERTICAL_IDS_STORAGE_KEY = "carousel-vertical-ids"

/**
 * The hero is a wide cinematic frame filled with `object-cover`, so anything
 * squarer than this comes out as a heavily cropped centre strip. 16:9 (1.78)
 * and 4:3 (1.33) pass; 1:1, 4:5 and 9:16 do not.
 */
export const WATCH_HOME_HERO_MIN_ASPECT_RATIO = 1.2

/**
 * Decided from the DECODED video, which is the only orientation signal the
 * catalog actually carries — admin exposes no video dimensions, and image
 * dimensions are a false proxy (landscape films routinely ship portrait
 * posters). Unknown or not-yet-measured sizes are allowed through: this guard
 * only ever acts on a confident portrait measurement.
 */
export function isWatchHomeHeroPlayableAspect(
  width: number | null | undefined,
  height: number | null | undefined,
): boolean {
  if (typeof width !== "number" || typeof height !== "number") return true
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true
  if (width <= 0 || height <= 0) return true
  return width / height >= WATCH_HOME_HERO_MIN_ASPECT_RATIO
}

export type WatchHomeTvCarouselVideoSlide = {
  kind: "video"
  id: string
  title: string
  label: string
  href: string | null
  posterUrl: string | null
  thumbnailUrl: string | null
  imageAlt: string
  src: string | null
  playbackId: string | null
  subtitleVttSrc?: string | null
  subtitleLanguageBcp47?: string | null
  durationSeconds: number | null
  poolId?: string
  poolIndex?: number
}

/**
 * The homepage hero plays catalog videos only. The branded Mux insert slide
 * kind was removed in feat-440, so this alias is the single slide shape.
 */
export type WatchHomeTvCarouselSlide = WatchHomeTvCarouselVideoSlide

export type WatchHomeCarouselPool = {
  id: string
  collectionIds: readonly string[]
  videos: readonly WatchHomeTvCarouselVideoSlide[]
}

export type WatchHomeCarouselSequenceData = {
  pools: readonly WatchHomeCarouselPool[]
}

export type WatchHomeCurrentVideoSession = {
  videoId: string
  videoTitle: string
  poolIndex: number
  poolId: string
  timestamp: number
}

type PlayedIdsStorageValue = {
  month?: unknown
  ids?: unknown
}

type QueueBuildInput = {
  pools: readonly WatchHomeCarouselPool[]
  existingVideos?: readonly WatchHomeTvCarouselVideoSlide[]
  /** Hard exclusion — see `pickRandomWatchHomeHeroVideo`. */
  excludedIds?: readonly string[]
  playedIds?: readonly string[]
  startPoolIndex?: number
  targetVideoCount: number
  now?: Date
  useStoredProgress?: boolean
  /**
   * Supplying a random source swaps the date-seeded pool offset for a
   * per-visit draw, so two visitors loading the same cached homepage HTML get
   * different lineups. Left undefined the queue stays deterministic, which is
   * what server render and hydration need.
   */
  randomSource?: () => number
}

function simpleHash(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash &= hash
  }
  return Math.abs(hash)
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function currentStorageMonth(now = new Date()) {
  return now.toISOString().slice(0, 7)
}

function businessDate(now: Date) {
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

export function readWatchHomeTvPlayedIds(now = new Date()): string[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
    if (!stored) return []

    const data = JSON.parse(stored) as PlayedIdsStorageValue
    if (data.month !== currentStorageMonth(now)) {
      localStorage.removeItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
      return []
    }

    return Array.isArray(data.ids)
      ? data.ids.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}

export function resetWatchHomeTvPlayedIds() {
  if (typeof window === "undefined") return

  try {
    localStorage.removeItem(WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY)
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function addWatchHomeTvPlayedId(slideId: string, now = new Date()) {
  if (typeof window === "undefined") return

  try {
    const current = readWatchHomeTvPlayedIds(now)
    const ids = current.includes(slideId) ? current : [...current, slideId]
    localStorage.setItem(
      WATCH_HOME_TV_PLAYED_IDS_STORAGE_KEY,
      JSON.stringify({
        month: currentStorageMonth(now),
        ids,
      }),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

/**
 * Videos a previous load measured as portrait. Kept in the same monthly bucket
 * as played ids so a re-encode or catalog correction self-heals within a month
 * instead of blacklisting a video forever.
 */
export function readWatchHomeVerticalVideoIds(now = new Date()): string[] {
  if (typeof window === "undefined") return []

  try {
    const stored = localStorage.getItem(WATCH_HOME_TV_VERTICAL_IDS_STORAGE_KEY)
    if (!stored) return []

    const data = JSON.parse(stored) as PlayedIdsStorageValue
    if (data.month !== currentStorageMonth(now)) {
      localStorage.removeItem(WATCH_HOME_TV_VERTICAL_IDS_STORAGE_KEY)
      return []
    }

    return Array.isArray(data.ids)
      ? data.ids.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}

export function addWatchHomeVerticalVideoId(slideId: string, now = new Date()) {
  if (typeof window === "undefined") return

  try {
    const current = readWatchHomeVerticalVideoIds(now)
    const ids = current.includes(slideId) ? current : [...current, slideId]
    localStorage.setItem(
      WATCH_HOME_TV_VERTICAL_IDS_STORAGE_KEY,
      JSON.stringify({ month: currentStorageMonth(now), ids }),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function poolVideosStorageKey(poolId: string) {
  return `pool-${poolId}-videos`
}

export function poolFailuresStorageKey(poolId: string) {
  return `pool-${poolId}-failures`
}

export function readWatchHomePoolPlayedIds(poolId: string): string[] {
  if (typeof window === "undefined") return []

  try {
    const value = sessionStorage.getItem(poolVideosStorageKey(poolId))
    return safeParseJson<string[]>(value, []).filter(
      (id): id is string => typeof id === "string",
    )
  } catch {
    return []
  }
}

function readWatchHomePoolFailures(poolId: string): number {
  if (typeof window === "undefined") return 0

  try {
    const value = sessionStorage.getItem(poolFailuresStorageKey(poolId))
    const failures = Number.parseInt(value ?? "0", 10)
    return Number.isFinite(failures) ? failures : 0
  } catch {
    return 0
  }
}

function resetWatchHomePoolFailures(poolId: string) {
  if (typeof window === "undefined") return

  try {
    sessionStorage.removeItem(poolFailuresStorageKey(poolId))
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

function markWatchHomePoolFailure(poolId: string, videoCount: number) {
  if (typeof window === "undefined") return

  try {
    const failures = readWatchHomePoolFailures(poolId) + 1
    sessionStorage.setItem(poolFailuresStorageKey(poolId), String(failures))

    if (failures < 3) return

    const played = readWatchHomePoolPlayedIds(poolId)
    const exhausted = [...played]
    for (let index = exhausted.length; index < videoCount; index++) {
      exhausted.push(`exhausted-${index}`)
    }
    sessionStorage.setItem(
      poolVideosStorageKey(poolId),
      JSON.stringify(exhausted),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function isWatchHomePoolExhausted(poolId: string, videoCount: number) {
  if (videoCount <= 0) return true
  return new Set(readWatchHomePoolPlayedIds(poolId)).size >= videoCount
}

export function markWatchHomePoolVideoPlayed(poolId: string, videoId: string) {
  if (typeof window === "undefined") return

  try {
    const current = readWatchHomePoolPlayedIds(poolId)
    if (current.includes(videoId)) return
    sessionStorage.setItem(
      poolVideosStorageKey(poolId),
      JSON.stringify([...current, videoId]),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function markWatchHomeVideoPlayed(
  slide: WatchHomeTvCarouselSlide | null,
) {
  if (!slide || slide.kind !== "video") return

  addWatchHomeTvPlayedId(slide.id)
  if (slide.poolId) {
    markWatchHomePoolVideoPlayed(slide.poolId, slide.id)
  }
}

export function saveWatchHomeCurrentVideoSession(
  slide: WatchHomeTvCarouselSlide | null,
) {
  if (typeof window === "undefined" || !slide || slide.kind !== "video") {
    return
  }

  try {
    const session: WatchHomeCurrentVideoSession = {
      videoId: slide.id,
      videoTitle: slide.title,
      poolIndex: slide.poolIndex ?? 0,
      poolId: slide.poolId ?? "unknown",
      timestamp: Date.now(),
    }
    sessionStorage.setItem(
      WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
      JSON.stringify(session),
    )
  } catch {
    // Ignore storage errors from private browsing or disabled storage.
  }
}

export function loadWatchHomeCurrentVideoSession(
  now = new Date(),
): WatchHomeCurrentVideoSession | null {
  if (typeof window === "undefined") return null

  try {
    const stored = sessionStorage.getItem(
      WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY,
    )
    const parsed = safeParseJson<WatchHomeCurrentVideoSession | null>(
      stored,
      null,
    )
    if (!parsed || typeof parsed.videoId !== "string") return null

    const ageMs = now.getTime() - parsed.timestamp
    if (ageMs > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY)
      return null
    }

    return parsed
  } catch {
    try {
      sessionStorage.removeItem(WATCH_HOME_TV_CURRENT_VIDEO_STORAGE_KEY)
    } catch {
      // Ignore storage errors from private browsing or disabled storage.
    }
    return null
  }
}

export function boundedRandomIndex(length: number, random: () => number) {
  if (length <= 0) return 0
  const raw = Math.floor(random() * length)
  if (!Number.isFinite(raw) || raw < 0) return 0
  return Math.min(length - 1, raw)
}

/**
 * Draws one playable video uniformly from every pool the server shipped, which
 * is the widest slice of the video library available to the browser without a
 * second round trip. Videos this browser already played are skipped until the
 * whole set has been seen.
 */
export function pickRandomWatchHomeHeroVideo({
  excludedIds,
  playedIds,
  pools,
  random = Math.random,
}: {
  /**
   * Hard exclusion, unlike `playedIds`: an excluded id is never drawn, even
   * once every remaining candidate has been played. Carries the videos a
   * previous load measured as portrait.
   */
  excludedIds?: readonly string[]
  playedIds?: readonly string[]
  pools: readonly WatchHomeCarouselPool[]
  random?: () => number
}): WatchHomeTvCarouselVideoSlide | null {
  const excluded = new Set(excludedIds ?? [])
  const byId = new Map<string, WatchHomeTvCarouselVideoSlide>()
  pools.forEach((pool, poolIndex) => {
    for (const video of pool.videos) {
      if (!video.src || byId.has(video.id) || excluded.has(video.id)) continue
      byId.set(video.id, { ...video, poolId: pool.id, poolIndex })
    }
  })

  const candidates = [...byId.values()]
  if (candidates.length === 0) return null

  const played = new Set(playedIds ?? [])
  const unplayed = candidates.filter((video) => !played.has(video.id))
  const drawFrom = unplayed.length > 0 ? unplayed : candidates

  return drawFrom[boundedRandomIndex(drawFrom.length, random)] ?? null
}

export function buildWatchHomeVideoQueue({
  existingVideos = [],
  excludedIds,
  now = new Date(),
  playedIds,
  pools,
  randomSource,
  startPoolIndex = 0,
  targetVideoCount,
  useStoredProgress = true,
}: QueueBuildInput): {
  videos: WatchHomeTvCarouselVideoSlide[]
  nextPoolIndex: number
} {
  const excluded = new Set(excludedIds ?? [])
  if (targetVideoCount <= existingVideos.length || pools.length === 0) {
    // Filtered on the early-exit path too, so no branch of this builder can
    // return an excluded id.
    return {
      videos: existingVideos.filter((video) => !excluded.has(video.id)),
      nextPoolIndex: startPoolIndex,
    }
  }

  if (existingVideos.length > 0 && existingVideos.length % 50 === 0) {
    resetWatchHomeTvPlayedIds()
  }

  const videos = existingVideos.filter((video) => !excluded.has(video.id))
  const seen = new Set(videos.map((video) => video.id))
  const persistentPlayed = new Set(
    playedIds ?? (useStoredProgress ? readWatchHomeTvPlayedIds(now) : []),
  )
  let poolIndex = Math.max(0, startPoolIndex)
  const isEligibleUnseen = (video: WatchHomeTvCarouselVideoSlide) =>
    Boolean(video.src) && !excluded.has(video.id) && !seen.has(video.id)
  const eligibleUnseenIds = new Set(
    pools.flatMap((pool) =>
      pool.videos.filter(isEligibleUnseen).map((video) => video.id),
    ),
  )
  let remainingEligibleCount = eligibleUnseenIds.size

  const fillQueue = (ignoreProgress: boolean) => {
    const respectPlayedProgress = !ignoreProgress
    const respectStoredProgress = useStoredProgress && !ignoreProgress
    let poolsWithoutSelection = 0

    while (
      videos.length < targetVideoCount &&
      poolsWithoutSelection < pools.length &&
      remainingEligibleCount > 0
    ) {
      const pool = pools[poolIndex % pools.length]

      if (
        !pool ||
        (respectStoredProgress &&
          isWatchHomePoolExhausted(pool.id, pool.videos.length))
      ) {
        poolIndex += 1
        poolsWithoutSelection += 1
        continue
      }

      const poolPlayed = new Set(
        respectStoredProgress ? readWatchHomePoolPlayedIds(pool.id) : [],
      )
      const candidates = pool.videos.filter(
        (video) =>
          isEligibleUnseen(video) &&
          (!respectPlayedProgress || !persistentPlayed.has(video.id)) &&
          !poolPlayed.has(video.id),
      )

      if (candidates.length === 0) {
        if (respectStoredProgress) {
          markWatchHomePoolFailure(pool.id, pool.videos.length)
        }
        poolIndex += 1
        poolsWithoutSelection += 1
        continue
      }

      const offset = randomSource
        ? boundedRandomIndex(candidates.length, randomSource)
        : getWatchHomeDeterministicOffset(pool.id, candidates.length, {
            now,
            poolIndex,
            totalVideosLoaded: videos.length,
          })
      const candidate = candidates[offset]
      if (candidate) {
        const video = {
          ...candidate,
          poolId: pool.id,
          poolIndex,
        }
        videos.push(video)
        seen.add(video.id)
        remainingEligibleCount -= 1
        if (respectStoredProgress) {
          resetWatchHomePoolFailures(pool.id)
        }
        poolsWithoutSelection = 0
      } else {
        poolsWithoutSelection += 1
      }

      poolIndex += 1
    }
  }

  fillQueue(false)
  if (videos.length < targetVideoCount && remainingEligibleCount > 0) {
    fillQueue(true)
  }

  return { videos, nextPoolIndex: poolIndex }
}
